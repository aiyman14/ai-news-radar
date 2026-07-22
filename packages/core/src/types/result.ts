/**
 * Typed Result — the error-handling convention for the whole pipeline.
 *
 * Expected failures (a feed 404s, a payload won't parse) are VALUES, not
 * exceptions: they flow into `source_errors` and the run continues.
 * `throw` is reserved for bugs and misconfiguration — things that should
 * stop the world.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Per-source outcome inside a run. */
export interface SourceIngestResult {
  sourceSlug: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  /** Human-readable error messages (full detail goes to source_errors). */
  errors: string[];
}

export type RunStatus = "success" | "partial" | "failed";
export type RunTrigger = "cron" | "manual";

/** Outcome of the post-persist clustering stage. */
export interface ClusterStageResult {
  /** Items in the comparison window (assigned + unassigned). */
  itemsConsidered: number;
  /** Items that received a (new) cluster_id this run. */
  itemsAssigned: number;
  clustersCreated: number;
  /** Existing clusters whose membership/upkeep fields changed. */
  clustersUpdated: number;
  /** Clusters deleted because a new item bridged them into another. */
  clustersMerged: number;
}

/** Outcome of the post-persist LLM enrichment stage. */
export interface EnrichStageResult {
  /** True when no generation provider is configured — stage did nothing. */
  skipped: boolean;
  /** Unenriched items found in the window (post-cap). */
  itemsConsidered: number;
  itemsEnriched: number;
  /** Provider/parse failures — items left unenriched for the next run. */
  itemsFailed: number;
}

/** Outcome of the post-enrich embedding stage. */
export interface EmbedStageResult {
  /** True when no embeddings provider is configured — stage did nothing. */
  skipped: boolean;
  /** Unembedded items found in the window (post-cap). */
  itemsConsidered: number;
  itemsEmbedded: number;
  /** Items in failed batches — left unembedded for the next run. */
  itemsFailed: number;
}

/** Whole-run outcome; mirrors the ingestion_runs row. */
export interface RunSummary {
  runId: string | null;
  trigger: RunTrigger;
  startedAt: string; // ISO UTC
  finishedAt: string; // ISO UTC
  status: RunStatus;
  itemsFetched: number;
  itemsNew: number;
  itemsFailed: number;
  sources: SourceIngestResult[];
  /** Undefined only when the enrich stage itself failed (error is in source_errors). */
  enrich?: EnrichStageResult;
  /** Undefined only when the embed stage itself failed (error is in source_errors). */
  embed?: EmbedStageResult;
  /** Undefined only when the cluster stage itself failed (error is in source_errors). */
  clusters?: ClusterStageResult;
}

/** Naming alias. */
export type IngestResult = RunSummary;
