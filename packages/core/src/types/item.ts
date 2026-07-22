/** JSON-safe value (what jsonb columns and adapter payloads carry). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * The 7-kind classification (schema addendum, FROZEN 2026-07-06).
 * `research` = papers/arXiv/technical results; `opinion` = hot-takes/essays.
 */
export const KINDS = [
  "news",
  "launch",
  "tool",
  "tip",
  "discussion",
  "research",
  "opinion",
] as const;
export type Kind = (typeof KINDS)[number];

export function isKind(value: unknown): value is Kind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/**
 * What an adapter emits: the source-native payload plus a stable external id.
 * The idempotency key (source_id, external_id) is the dedup backbone —
 * adapters MUST always derive an externalId (native id if present, else
 * canonical URL + content hash). It is never empty.
 */
export interface RawItem {
  externalId: string;
  payload: Json;
}

/**
 * A normalized item before persistence (no DB ids yet).
 * Times are Date objects in UTC; the DB stores timestamptz.
 * Display is Eastern (America/New_York) — a web-layer concern only.
 */
export interface NormalizedDraft {
  externalId: string;
  canonicalUrl: string | null;
  title: string;
  bodyText: string | null;
  bodyHtml: string | null;
  imageUrl: string | null;
  media: Record<string, Json>;
  authorName: string | null;
  publishedAt: Date | null;
  language: string;
  tags: string[];
  entities: string[];
  engagement: Record<string, Json> | null;
  contentHash: string;
  kind: Kind;
  kindConfidence: number;
  score: number;
}

/**
 * The clustering stage's view of a persisted item: the minimal
 * projection of normalized_items the algorithm needs. Repos map rows into
 * this shape; the pipeline never sees raw rows.
 */
export interface ClusterableItem {
  id: string;
  title: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  score: number;
  tags: string[];
  entities: string[];
  bodyText: string | null;
  /** Current assignment; null = unclustered (singletons stay null). */
  clusterId: string | null;
  /**
   * Embedding vector — populated only when the stage runs with the
   * semantic assist on (CLUSTER_SEMANTIC=1); undefined/null otherwise.
   */
  embedding?: number[] | null;
}

/**
 * The enrich stage's view of a persisted item: what the LLM
 * enrichment prompt consumes + the deterministic values it may improve.
 */
export interface EnrichableItem {
  id: string;
  title: string;
  bodyText: string | null;
  kind: Kind;
  kindConfidence: number;
  tags: string[];
  entities: string[];
}

/** One item's enrichment write-back (llm_summary always; rest optional). */
export interface EnrichmentUpdate {
  id: string;
  llmSummary: string;
  enrichedAt: Date;
  /** Present only when the model confidently improved the classification. */
  kind?: Kind;
  kindConfidence?: number;
  /** Present only when the model added tags/entities (union with existing). */
  tags?: string[];
  entities?: string[];
}

/** The embed stage's view of a persisted item: the text worth embedding. */
export interface EmbeddableItem {
  id: string;
  title: string;
  llmSummary: string | null;
  bodyText: string | null;
}

/**
 * Deterministic upkeep fields written to a story_clusters row — always
 * recomputed in full from the cluster's membership (never incremented),
 * so re-running clustering converges instead of drifting.
 */
export interface ClusterPatch {
  representativeId: string;
  title: string;
  summary: string | null;
  tags: string[];
  entities: string[];
  itemCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  score: number;
}

/** A story cluster header as the pipeline sees it. */
export interface Story {
  title: string;
  summary: string | null;
  tags: string[];
  entities: string[];
  itemCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  score: number;
}
