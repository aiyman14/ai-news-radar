import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IngestionRunRow,
  NormalizedItemRow,
  SourceRow,
  StoryClusterRow,
} from "@radar/core";

/**
 * Central data-access layer. Every function takes the Supabase client as its
 * first argument; pages construct it with `createServerSupabase()` (the anon
 * key — the dashboard is public-read and RLS allows anon SELECT only).
 * No function here ever uses the service role.
 */

export type FeedItem = NormalizedItemRow & {
  /** item_count of the item's story cluster (null when unclustered) — powers the "📚 N sources" chip. */
  cluster_size: number | null;
};

/**
 * Embed the parent cluster's item_count on each item row. The FK hint is
 * required: normalized_items↔story_clusters are linked by TWO foreign keys
 * (cluster_id here, representative_id on the cluster) and PostgREST needs
 * to know which one to follow.
 */
const ITEM_SELECT = "*, story_clusters!normalized_items_cluster_id_fkey(item_count)";

type EmbeddedItemRow = NormalizedItemRow & {
  story_clusters: { item_count: number } | null;
};

function flattenClusterSize(rows: EmbeddedItemRow[]): FeedItem[] {
  return rows.map(({ story_clusters, ...item }) => ({
    ...item,
    cluster_size: story_clusters?.item_count ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Feed / kind pages
// ---------------------------------------------------------------------------

export const FEED_PAGE_SIZE = 50;

/** Server-side feed filters — all URL-param driven. */
export interface FeedFilters {
  /** Full-text search — PostgREST textSearch on the indexed `fts` tsvector (websearch syntax). */
  q?: string;
  kinds?: string[];
  sourceId?: string;
  /** published_at within the last N hours. */
  sinceHours?: number;
  hasImage?: boolean;
  clusteredOnly?: boolean;
  /** tags/entities array containment (clickable tags/entities). */
  tag?: string;
  entity?: string;
}

export interface FeedPage {
  items: FeedItem[];
  page: number; // 1-based
  hasMore: boolean;
  /** Exact server-side match count — powers "N results". */
  total: number | null;
  error: string | null;
}

/**
 * Latest active items, `published_at desc nulls last`, filtered server-side
 * (FTS, kind, source, date window, image/cluster presence, tag/entity),
 * paginated (~50/page).
 */
export async function fetchFeedPage(
  supabase: SupabaseClient,
  options: FeedFilters & { page?: number; pageSize?: number } = {},
): Promise<FeedPage> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? FEED_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("normalized_items")
    .select(ITEM_SELECT, { count: "exact" })
    .eq("status", "active")
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);
  if (options.kinds && options.kinds.length > 0) {
    query = query.in("kind", options.kinds);
  }
  if (options.q) {
    query = query.textSearch("fts", options.q, { type: "websearch" });
  }
  if (options.sourceId) {
    query = query.eq("source_id", options.sourceId);
  }
  if (options.sinceHours && options.sinceHours > 0) {
    query = query.gte(
      "published_at",
      new Date(Date.now() - options.sinceHours * 3_600_000).toISOString(),
    );
  }
  if (options.hasImage) {
    query = query.not("image_url", "is", null);
  }
  if (options.clusteredOnly) {
    query = query.not("cluster_id", "is", null);
  }
  if (options.tag) {
    query = query.contains("tags", [options.tag]);
  }
  if (options.entity) {
    query = query.contains("entities", [options.entity]);
  }

  const itemsRes = await query;
  if (itemsRes.error) {
    return { items: [], page, hasMore: false, total: null, error: itemsRes.error.message };
  }

  const rows = (itemsRes.data ?? []) as unknown as EmbeddedItemRow[];
  return {
    items: flattenClusterSize(rows),
    page,
    hasMore: rows.length === pageSize,
    total: itemsRes.count ?? null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Latest ingestion run (header refresh timer)
// ---------------------------------------------------------------------------

/** Most recent ingestion run, for "Last: … · N new" in the header. */
export async function fetchLatestRun(
  supabase: SupabaseClient,
): Promise<{ run: IngestionRunRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { run: null, error: error.message };
  return { run: (data as IngestionRunRow | null) ?? null, error: null };
}

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------

export interface TrendingCount {
  name: string;
  count: number;
  /** count minus the same name's count in the PREVIOUS equal-length window. */
  delta: number;
}

export interface TrendingWindow {
  hours: number;
  tags: TrendingCount[];
  entities: TrendingCount[];
}

/**
 * Top tags/entities over 24/48/72h windows, each with a ▲/▼ delta vs the
 * previous equal window (e.g. 24h window compares [now-24h, now] against
 * [now-48h, now-24h]).
 *
 * TRADE-OFF (documented): the ideal is SQL `select unnest(tags), count(*)
 * ... group by 1` — but PostgREST cannot express unnest aggregation.
 * Fallback taken: fetch a BOUNDED recent window server-side (only
 * tags/entities/published_at columns, 2× the widest window so previous
 * windows are covered, capped at 4000 rows) and aggregate in the server
 * component in one pass. A future migration can promote this to a
 * `trending_tags(hours)` RPC and delete the in-process aggregation.
 */
export async function fetchTrending(
  supabase: SupabaseClient,
  windowsHours: number[] = [24, 48, 72],
  topN = 15,
): Promise<{ windows: TrendingWindow[]; error: string | null }> {
  const maxHours = Math.max(...windowsHours);
  // 2× the widest window: the current windows plus their previous windows.
  const since = new Date(Date.now() - 2 * maxHours * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from("normalized_items")
    .select("tags, entities, published_at")
    .eq("status", "active")
    .gte("published_at", since)
    .limit(4000);
  if (error) return { windows: [], error: error.message };

  const rows = (data ?? []) as Array<{
    tags: string[];
    entities: string[];
    published_at: string | null;
  }>;

  const windows = windowsHours.map((hours) => {
    const cutoff = Date.now() - hours * 3_600_000;
    const prevCutoff = Date.now() - 2 * hours * 3_600_000;
    const current: typeof rows = [];
    const previous: typeof rows = [];
    for (const r of rows) {
      if (!r.published_at) continue;
      const t = new Date(r.published_at).getTime();
      if (t >= cutoff) current.push(r);
      else if (t >= prevCutoff) previous.push(r);
    }
    return {
      hours,
      tags: topCountsWithDelta(
        current.map((r) => r.tags),
        previous.map((r) => r.tags),
        topN,
      ),
      entities: topCountsWithDelta(
        current.map((r) => r.entities),
        previous.map((r) => r.entities),
        topN,
      ),
    };
  });
  return { windows, error: null };
}

function countValues(lists: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function topCountsWithDelta(
  currentLists: string[][],
  previousLists: string[][],
  topN: number,
): TrendingCount[] {
  const current = countValues(currentLists);
  const previous = countValues(previousLists);
  return [...current.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, count]) => ({ name, count, delta: count - (previous.get(name) ?? 0) }));
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export type TopStory = StoryClusterRow & { representative: NormalizedItemRow | null };

/**
 * Top-stories strip: up to `limit` highest-score clusters seen in the last
 * 24h; if fewer than `minCount`, widen to 72h. Representatives are fetched
 * for thumbnails/source names.
 */
export async function fetchTopStories(
  supabase: SupabaseClient,
  options: { hours?: number; fallbackHours?: number; minCount?: number; limit?: number } = {},
): Promise<{ stories: TopStory[]; windowHours: number; error: string | null }> {
  const { hours = 24, fallbackHours = 72, minCount = 3, limit = 6 } = options;

  const queryWindow = (h: number) =>
    supabase
      .from("story_clusters")
      .select("*")
      .gte("last_seen_at", new Date(Date.now() - h * 3_600_000).toISOString())
      .order("score", { ascending: false })
      .limit(limit);

  let windowHours = hours;
  let res = await queryWindow(hours);
  if (!res.error && (res.data ?? []).length < minCount) {
    windowHours = fallbackHours;
    res = await queryWindow(fallbackHours);
  }
  if (res.error) return { stories: [], windowHours, error: res.error.message };

  const clusters = (res.data ?? []) as StoryClusterRow[];
  if (clusters.length === 0) return { stories: [], windowHours, error: null };

  const repIds = clusters.map((c) => c.representative_id).filter((id): id is string => !!id);
  const repsRes =
    repIds.length > 0
      ? await supabase.from("normalized_items").select("*").in("id", repIds)
      : { data: [], error: null };
  const reps = new Map(
    ((repsRes.data ?? []) as NormalizedItemRow[]).map((item) => [item.id, item]),
  );

  return {
    stories: clusters.map((c) => ({
      ...c,
      representative: c.representative_id ? (reps.get(c.representative_id) ?? null) : null,
    })),
    windowHours,
    error: null,
  };
}

/** Cluster header + member items. */
export async function fetchStory(
  supabase: SupabaseClient,
  clusterId: string,
): Promise<{ cluster: StoryClusterRow | null; items: FeedItem[]; error: string | null }> {
  const [clusterRes, itemsRes] = await Promise.all([
    supabase.from("story_clusters").select("*").eq("id", clusterId).maybeSingle(),
    supabase
      .from("normalized_items")
      .select("*")
      .eq("cluster_id", clusterId)
      .eq("status", "active")
      .order("published_at", { ascending: false, nullsFirst: false }),
  ]);

  if (clusterRes.error) return { cluster: null, items: [], error: clusterRes.error.message };
  const raw = clusterRes.data as StoryClusterRow | null;
  if (!raw) return { cluster: null, items: [], error: null };

  const members = ((itemsRes.data ?? []) as NormalizedItemRow[]).map((m) => ({
    ...m,
    cluster_size: raw.item_count,
  }));
  return { cluster: raw, items: members, error: null };
}

// ---------------------------------------------------------------------------
// Sources health
// ---------------------------------------------------------------------------

export type SourceHealth = SourceRow & {
  items_ingested: number;
  last_item_at: string | null;
  recent_error_count: number; // last 7 days
};

/**
 * Per-source health from sources + ingestion_runs + source_errors.
 * `ingestion_runs` has no source_id (runs sweep all sources), so runs are
 * reported globally; per-source freshness comes from the items themselves
 * (max fetched_at). Counts are aggregated in-process over bounded selects
 * (same PostgREST-can't-aggregate trade-off as trending, documented there).
 */
export async function fetchSourcesHealth(supabase: SupabaseClient): Promise<{
  sources: SourceHealth[];
  runs: IngestionRunRow[];
  error: string | null;
}> {
  const errorsSince = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const [sourcesRes, runsRes, itemsRes, errorsRes] = await Promise.all([
    supabase.from("sources").select("*").order("slug"),
    supabase
      .from("ingestion_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("normalized_items")
      .select("source_id, fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(10_000),
    supabase
      .from("source_errors")
      .select("source_id")
      .gte("occurred_at", errorsSince)
      .limit(2000),
  ]);

  const firstError =
    sourcesRes.error ?? runsRes.error ?? itemsRes.error ?? errorsRes.error ?? null;
  if (firstError) return { sources: [], runs: [], error: firstError.message };

  const itemCount = new Map<string, number>();
  const lastItemAt = new Map<string, string>();
  for (const row of (itemsRes.data ?? []) as Array<{
    source_id: string;
    fetched_at: string;
  }>) {
    itemCount.set(row.source_id, (itemCount.get(row.source_id) ?? 0) + 1);
    if (!lastItemAt.has(row.source_id)) lastItemAt.set(row.source_id, row.fetched_at); // rows are fetched_at desc
  }
  const errorCount = new Map<string, number>();
  for (const row of (errorsRes.data ?? []) as Array<{ source_id: string | null }>) {
    if (!row.source_id) continue;
    errorCount.set(row.source_id, (errorCount.get(row.source_id) ?? 0) + 1);
  }

  return {
    sources: ((sourcesRes.data ?? []) as SourceRow[]).map((s) => ({
      ...s,
      items_ingested: itemCount.get(s.id) ?? 0,
      last_item_at: lastItemAt.get(s.id) ?? null,
      recent_error_count: errorCount.get(s.id) ?? 0,
    })),
    runs: (runsRes.data ?? []) as IngestionRunRow[],
    error: null,
  };
}

/** All configured sources (for the feed's source filter). */
export async function fetchAllSources(
  supabase: SupabaseClient,
): Promise<{ sources: SourceRow[]; error: string | null }> {
  const { data, error } = await supabase.from("sources").select("*").order("name");
  if (error) return { sources: [], error: error.message };
  return { sources: (data ?? []) as SourceRow[], error: null };
}
