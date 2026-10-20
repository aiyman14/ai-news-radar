import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceConfig } from "../types/source";
import type {
  IngestionRunRow,
  NormalizedItemRow,
  SourceErrorRow,
  SourceRow,
  StoryClusterRow,
} from "../types/db";
import type { Json } from "../types/item";
import type { MemoryStores } from "./repositories/memory";

/**
 * Snapshot — the hand-off between the pipeline and the web build.
 *
 * The radar is stateless: every scheduled run fetches all sources fresh,
 * runs the pipeline against the in-memory repositories, and serializes the
 * result to ONE JSON file. `next build` reads that file and emits static
 * HTML. Nothing is stored between runs — the sources themselves are the
 * database, and yesterday's radar is simply replaced by today's.
 */
export interface Snapshot {
  /** ISO time the snapshot was written. */
  generatedAt: string;
  sources: SourceRow[];
  items: NormalizedItemRow[];
  clusters: StoryClusterRow[];
  runs: IngestionRunRow[];
  errors: SourceErrorRow[];
}

/** body_text is capped — the dashboard never renders full bodies. */
export const BODY_TEXT_MAX_CHARS = 600;

/**
 * Freshness window. Some feeds return their entire archive (OpenAI's RSS
 * goes back to 2015), so a "latest" radar must cut by date: an item stays
 * when (published_at ?? fetched_at) is within the window.
 */
export const DEFAULT_WINDOW_DAYS = 14;

export interface SnapshotOptions {
  /** Drop items older than this many days (0 = keep everything). */
  windowDays?: number;
}

function sourceToRow(s: SourceConfig, at: string): SourceRow {
  return {
    id: s.id,
    slug: s.slug,
    type: s.type,
    name: s.name,
    url: s.url,
    config: s.config,
    trust_score: s.trustScore,
    default_kind_hint: s.defaultKindHint,
    enabled: s.enabled,
    created_at: at,
    updated_at: at,
  };
}

function itemToRow(
  entry: MemoryStores["normalizedItems"][number],
  source: { type: string; name: string },
): NormalizedItemRow {
  const d = entry.draft;
  const body =
    d.bodyText && d.bodyText.length > BODY_TEXT_MAX_CHARS
      ? `${d.bodyText.slice(0, BODY_TEXT_MAX_CHARS).trimEnd()}…`
      : d.bodyText;
  return {
    id: entry.id,
    raw_item_id: entry.rawItemId,
    source_id: entry.sourceId,
    source_type: source.type,
    source_name: source.name,
    external_id: d.externalId,
    canonical_url: d.canonicalUrl,
    title: d.title,
    body_text: body,
    body_html: null, // never rendered; the bulkiest field
    image_url: d.imageUrl,
    media: d.media,
    author_name: d.authorName,
    published_at: d.publishedAt ? d.publishedAt.toISOString() : null,
    fetched_at: entry.fetchedAt,
    language: d.language,
    tags: d.tags,
    entities: d.entities,
    engagement: d.engagement,
    content_hash: d.contentHash || null,
    kind: d.kind,
    kind_confidence: d.kindConfidence,
    score: d.score,
    cluster_id: entry.clusterId,
    status: "active",
    created_at: entry.fetchedAt,
    embedding: null, // 1024 floats/row — not worth shipping to a static build
    llm_summary: entry.llmSummary ?? null,
    llm_enriched_at: entry.llmEnrichedAt ?? null,
  };
}

function clusterToRow(c: MemoryStores["clusters"][number]): StoryClusterRow {
  return {
    id: c.id,
    representative_id: c.representativeId || null,
    title: c.title || null,
    summary: c.summary,
    tags: c.tags,
    entities: c.entities,
    item_count: c.itemCount,
    first_seen_at: c.firstSeenAt || null,
    last_seen_at: c.lastSeenAt || null,
    score: c.score,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function runToRow(r: MemoryStores["runs"][number]): IngestionRunRow {
  return {
    id: r.id,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    trigger: r.trigger,
    items_fetched: r.itemsFetched,
    items_new: r.itemsNew,
    items_failed: r.itemsFailed,
    status: r.status === "running" ? "failed" : r.status,
    notes: r.notes,
  };
}

/**
 * Serialize the in-memory stores after a run. Pure.
 * Applies the freshness window, then reconciles clusters against the
 * surviving items: item_count is recomputed, clusters left with fewer
 * than two members are dropped and their items unassigned.
 */
export function buildSnapshot(
  stores: MemoryStores,
  generatedAt: Date,
  options: SnapshotOptions = {},
): Snapshot {
  const at = generatedAt.toISOString();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const cutoff = windowDays > 0 ? generatedAt.getTime() - windowDays * 24 * 3_600_000 : null;
  const sourceOf = (id: string) => {
    const s = stores.sources.find((x) => x.id === id);
    return s ? { type: s.type, name: s.name } : { type: "unknown", name: id };
  };

  const fresh = stores.normalizedItems.filter((n) => {
    if (cutoff === null) return true;
    const when = n.draft.publishedAt ?? new Date(n.fetchedAt);
    return when.getTime() >= cutoff;
  });

  const members = new Map<string, number>();
  for (const n of fresh) if (n.clusterId) members.set(n.clusterId, (members.get(n.clusterId) ?? 0) + 1);
  const keptClusters = stores.clusters.filter((c) => (members.get(c.id) ?? 0) >= 2);
  const keptIds = new Set(keptClusters.map((c) => c.id));

  const items = fresh
    .map((n) => {
      const row = itemToRow(n, sourceOf(n.sourceId));
      if (row.cluster_id && !keptIds.has(row.cluster_id)) row.cluster_id = null;
      return row;
    })
    .sort((a, b) => (a.fetched_at === b.fetched_at ? (a.id < b.id ? -1 : 1) : a.fetched_at < b.fetched_at ? 1 : -1));

  return {
    generatedAt: at,
    sources: stores.sources.map((s) => sourceToRow(s, at)),
    items,
    clusters: keptClusters
      .map((c) => ({ ...clusterToRow(c), item_count: members.get(c.id) ?? 0 }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    runs: stores.runs.map(runToRow).sort((a, b) => (a.started_at < b.started_at ? 1 : -1)),
    errors: stores.errors.map((e, i) => ({
      id: `${e.runId ?? "run"}-${i}`,
      run_id: e.runId,
      source_id: e.sourceId,
      occurred_at: at,
      phase: e.phase,
      message: e.message,
      detail: (e.detail ?? null) as Json | null,
    })),
  };
}

/** An empty snapshot — what the web build uses when no file exists yet. */
export function emptySnapshot(): Snapshot {
  return { generatedAt: "", sources: [], items: [], clusters: [], runs: [], errors: [] };
}

export async function writeSnapshotFile(file: string, snapshot: Snapshot): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(snapshot)}\n`, "utf8");
}

/** Missing file → empty snapshot (the app renders empty states; nothing throws). */
export async function readSnapshotFile(file: string): Promise<Snapshot> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Snapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
    throw new Error(`snapshot: cannot read ${file}: ${(e as Error).message}`);
  }
}
