import type {
  IngestionRunRow,
  NormalizedItemRow,
  Snapshot,
  SourceRow,
  StoryClusterRow,
} from "@radar/core";
import { toItemCards, type ItemCard } from "./item-card";

/**
 * Build-time query layer: pure functions over the loaded Snapshot. Every
 * page calls these during `next build`; nothing here runs in the browser.
 * "Now" is the snapshot's write time so a rebuild of the same data renders
 * the same pages.
 */

export function snapshotNow(snapshot: Snapshot): number {
  return snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : Date.now();
}

const cardsCache = new WeakMap<Snapshot, ItemCard[]>();

/** All active items as cards, newest first (memoized per snapshot). */
export function allCards(snapshot: Snapshot): ItemCard[] {
  let cards = cardsCache.get(snapshot);
  if (!cards) {
    cards = toItemCards(snapshot.items, snapshot.clusters);
    cardsCache.set(snapshot, cards);
  }
  return cards;
}

export function cardsOfKinds(snapshot: Snapshot, kinds: readonly string[]): ItemCard[] {
  const wanted = new Set(kinds);
  return allCards(snapshot).filter((c) => wanted.has(c.kind));
}

// ---------------------------------------------------------------------------
// Latest run (header refresh timer)
// ---------------------------------------------------------------------------

export function latestRun(snapshot: Snapshot): IngestionRunRow | null {
  return [...snapshot.runs].sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0] ?? null;
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

function countValues(lists: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function topCountsWithDelta(current: string[][], previous: string[][], topN: number): TrendingCount[] {
  const cur = countValues(current);
  const prev = countValues(previous);
  return [...cur.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([name, count]) => ({ name, count, delta: count - (prev.get(name) ?? 0) }));
}

/**
 * Top tags/entities over 24/48/72h windows, each with a ▲/▼ delta vs the
 * previous equal window (the 24h window compares [now-24h, now] against
 * [now-48h, now-24h]).
 */
export function trending(
  snapshot: Snapshot,
  windowsHours: number[] = [24, 48, 72],
  topN = 15,
): TrendingWindow[] {
  const now = snapshotNow(snapshot);
  const rows = snapshot.items.filter((i) => i.status === "active" && i.published_at);
  return windowsHours.map((hours) => {
    const cutoff = now - hours * 3_600_000;
    const prevCutoff = now - 2 * hours * 3_600_000;
    const current: NormalizedItemRow[] = [];
    const previous: NormalizedItemRow[] = [];
    for (const r of rows) {
      const t = Date.parse(r.published_at as string);
      if (t >= cutoff) current.push(r);
      else if (t >= prevCutoff) previous.push(r);
    }
    return {
      hours,
      tags: topCountsWithDelta(current.map((r) => r.tags), previous.map((r) => r.tags), topN),
      entities: topCountsWithDelta(current.map((r) => r.entities), previous.map((r) => r.entities), topN),
    };
  });
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export type TopStory = StoryClusterRow & { representative: NormalizedItemRow | null };

/**
 * Top-stories strip: up to `limit` highest-score clusters seen in the last
 * 24h; if fewer than `minCount`, widen to 72h.
 */
export function topStories(
  snapshot: Snapshot,
  options: { hours?: number; fallbackHours?: number; minCount?: number; limit?: number } = {},
): { stories: TopStory[]; windowHours: number } {
  const { hours = 24, fallbackHours = 72, minCount = 3, limit = 6 } = options;
  const now = snapshotNow(snapshot);
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));

  const inWindow = (h: number) =>
    snapshot.clusters
      .filter((c) => c.last_seen_at && Date.parse(c.last_seen_at) >= now - h * 3_600_000)
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, limit);

  let windowHours = hours;
  let clusters = inWindow(hours);
  if (clusters.length < minCount) {
    windowHours = fallbackHours;
    clusters = inWindow(fallbackHours);
  }
  return {
    stories: clusters.map((c) => ({
      ...c,
      representative: c.representative_id ? (byId.get(c.representative_id) ?? null) : null,
    })),
    windowHours,
  };
}

/** Cluster header + member items (cards), newest first. */
export function story(
  snapshot: Snapshot,
  clusterId: string,
): { cluster: StoryClusterRow | null; items: ItemCard[] } {
  const cluster = snapshot.clusters.find((c) => c.id === clusterId) ?? null;
  if (!cluster) return { cluster: null, items: [] };
  return { cluster, items: allCards(snapshot).filter((i) => i.cluster_id === clusterId) };
}

// ---------------------------------------------------------------------------
// Sources health
// ---------------------------------------------------------------------------

export type SourceHealth = SourceRow & {
  items_ingested: number;
  last_item_at: string | null;
  recent_error_count: number; // last 7 days
};

export function sourcesHealth(snapshot: Snapshot): { sources: SourceHealth[]; runs: IngestionRunRow[] } {
  const now = snapshotNow(snapshot);
  const errorsSince = now - 7 * 24 * 3_600_000;

  const itemCount = new Map<string, number>();
  const lastItemAt = new Map<string, string>();
  for (const row of snapshot.items) {
    itemCount.set(row.source_id, (itemCount.get(row.source_id) ?? 0) + 1);
    const prev = lastItemAt.get(row.source_id);
    if (!prev || prev < row.fetched_at) lastItemAt.set(row.source_id, row.fetched_at);
  }
  const errorCount = new Map<string, number>();
  for (const e of snapshot.errors) {
    if (!e.source_id || Date.parse(e.occurred_at) < errorsSince) continue;
    errorCount.set(e.source_id, (errorCount.get(e.source_id) ?? 0) + 1);
  }

  return {
    sources: [...snapshot.sources]
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((s) => ({
        ...s,
        items_ingested: itemCount.get(s.id) ?? 0,
        last_item_at: lastItemAt.get(s.id) ?? null,
        recent_error_count: errorCount.get(s.id) ?? 0,
      })),
    runs: [...snapshot.runs].sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, 10),
  };
}

/** All configured sources, by name (for the search page's source filter). */
export function sourceOptions(snapshot: Snapshot): Array<{ id: string; name: string }> {
  return [...snapshot.sources]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}
