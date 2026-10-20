// @radar/core public surface. Later tasks import from "@radar/core" only —
// deep imports into src/ are an anti-pattern (keeps refactors cheap).

// types
export * from "./types/item";
export * from "./types/source";
export * from "./types/result";
export * from "./types/db";
export * from "./errors";

// adapter contract + registry
export type { SourceAdapter, FetchContext, Logger } from "./adapters/types";
export { getAdapter, type AdapterResolver } from "./adapters/registry";
export { createStubAdapter } from "./adapters/stub";
export { fakeAdapter } from "./adapters/fake";

// pipeline
export {
  runIngest,
  parseLlmMaxItems,
  type IngestDeps,
  type IngestOptions,
} from "./pipeline/index";
export { normalizeRawItem } from "./pipeline/normalize";
export { classifyKind } from "./pipeline/classify";
export { extractTags, extractEntities } from "./pipeline/extract";
export { partitionNew, type DedupInput, type DedupOutcome } from "./pipeline/dedup";
export {
  runEnrichStage,
  buildEnrichmentPrompt,
  parseEnrichmentResponse,
  planEnrichmentUpdate,
  ENRICH_SYSTEM_PROMPT,
  ENRICH_WINDOW_HOURS,
  ENRICH_KIND_CONFIDENCE,
  DEFAULT_LLM_MAX_ITEMS_PER_RUN,
  type EnrichStageDeps,
  type EnrichStageOptions,
  type ParsedEnrichment,
} from "./pipeline/enrich";
export {
  runEmbedStage,
  embeddingText,
  EMBED_WINDOW_HOURS,
  EMBED_BATCH_SIZE,
  type EmbedStageDeps,
  type EmbedStageOptions,
} from "./pipeline/embed";
export {
  titleSimilarity,
  cosineSimilarity,
  mapCosineToSimilarity,
  groupWindowItems,
  computeClusterPatch,
  summarizeBody,
  runClusterStage,
  CLUSTER_SIMILARITY_THRESHOLD,
  CLUSTER_SHINGLE_SIZE,
  CLUSTER_WINDOW_HOURS,
  CLUSTER_SUMMARY_MAX_CHARS,
  SEMANTIC_COSINE_FLOOR,
  type ClusterStageDeps,
  type ClusterStageOptions,
  type GroupingOptions,
} from "./pipeline/cluster";
export { scoreItem } from "./pipeline/score";

// providers
export * from "./providers/index";

// sources (the source table lives in code)
export { SOURCES, findSource } from "./sources";

// persistence: in-memory repositories + the snapshot the web build reads
export * from "./db/repositories/index";
export {
  buildSnapshot,
  emptySnapshot,
  readSnapshotFile,
  writeSnapshotFile,
  BODY_TEXT_MAX_CHARS,
  DEFAULT_WINDOW_DAYS,
  type Snapshot,
  type SnapshotOptions,
} from "./db/snapshot";

// util
export { sha256Hex, contentHash } from "./util/hash";
export { wordShingles, normalizeForShingles } from "./util/shingle";
export { jaccard } from "./util/jaccard";
export * from "./util/keywords";
