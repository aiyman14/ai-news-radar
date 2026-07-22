import type {
  ClusterableItem,
  ClusterPatch,
  EmbeddableItem,
  EnrichableItem,
  EnrichmentUpdate,
  NormalizedDraft,
  RawItem,
} from "../../types/item";
import type { SourceConfig } from "../../types/source";
import type { RunStatus, RunTrigger } from "../../types/result";
import type { IngestPhase } from "../../errors";

/**
 * Repository interfaces — the pipeline's only view of persistence.
 * Two implementations: Supabase (service-role, production path) and
 * in-memory (tests + --dry-run). Later tasks add methods here first,
 * then implement in both.
 */

export interface SourcesRepo {
  listEnabled(): Promise<SourceConfig[]>;
  /** Fetch by slug regardless of enabled flag (explicit --source runs). */
  getBySlugs(slugs: string[]): Promise<SourceConfig[]>;
}

export interface RunsRepo {
  start(trigger: RunTrigger): Promise<string>; // returns run id
  finish(
    runId: string,
    patch: {
      status: RunStatus;
      itemsFetched: number;
      itemsNew: number;
      itemsFailed: number;
      notes?: string;
    },
  ): Promise<void>;
}

export interface ItemsRepo {
  /** Which of these externalIds already exist for this source. */
  findExistingExternalIds(sourceId: string, externalIds: string[]): Promise<Set<string>>;
  /**
   * Insert raw_items + normalized_items for fresh items, atomically enough
   * for MVP (raw first, then normalized referencing raw ids).
   * Returns the number of normalized items inserted.
   */
  insertItems(args: {
    runId: string;
    source: SourceConfig;
    items: Array<{ raw: RawItem; draft: NormalizedDraft }>;
    fetchedAt: Date;
  }): Promise<number>;
}

export interface ErrorsRepo {
  record(entry: {
    runId: string | null;
    sourceId: string | null;
    phase: IngestPhase;
    message: string;
    detail?: unknown;
  }): Promise<void>;
}

/**
 * Clusters persistence. Methods are deliberately dumb CRUD —
 * ALL clustering logic (grouping, representative choice, merge-winner
 * selection) lives in pipeline/cluster.ts so the two implementations
 * can't drift behaviorally.
 */
export interface ClustersRepo {
  /**
   * Active items with fetched_at >= since — the comparison window.
   * withEmbeddings: also load embedding vectors (semantic assist only —
   * they're 1024 floats/row, don't fetch them when unused).
   */
  listClusterableItems(since: Date, opts?: { withEmbeddings?: boolean }): Promise<ClusterableItem[]>;
  /** Full membership of the given clusters (for upkeep recomputation + merges). */
  listItemsByClusterIds(clusterIds: string[]): Promise<ClusterableItem[]>;
  /** Insert a story_clusters row; returns its id. */
  createCluster(patch: ClusterPatch): Promise<string>;
  updateCluster(clusterId: string, patch: ClusterPatch): Promise<void>;
  /** Point normalized_items.cluster_id at clusterId for these items. */
  assignItems(clusterId: string, itemIds: string[]): Promise<void>;
  /** Delete merged-away clusters (members must be reassigned FIRST). */
  deleteClusters(clusterIds: string[]): Promise<void>;
}

/**
 * Intelligence persistence — the enrich + embed stages' view of
 * normalized_items' LLM columns. Same philosophy as ClustersRepo: dumb
 * CRUD; ALL prompting/parsing/capping logic lives in pipeline/enrich.ts +
 * pipeline/embed.ts. "Unprocessed" is keyed on the columns being null
 * (llm_enriched_at / embedding) — items are immutable, so processed-once
 * is the cache.
 */
export interface IntelligenceRepo {
  /** Active items with llm_enriched_at IS NULL and fetched_at >= since, ordered by id, capped. */
  listEnrichableItems(since: Date, limit: number): Promise<EnrichableItem[]>;
  /** Write llm_summary/llm_enriched_at (+ optional kind/tags/entities improvements). */
  saveEnrichments(updates: EnrichmentUpdate[]): Promise<void>;
  /** Active items with embedding IS NULL and fetched_at >= since, ordered by id, capped. */
  listEmbeddableItems(since: Date, limit: number): Promise<EmbeddableItem[]>;
  /** Write embedding vectors (dimension = the column's 1024). */
  saveEmbeddings(rows: Array<{ id: string; embedding: number[] }>): Promise<void>;
}

export interface Repositories {
  sources: SourcesRepo;
  runs: RunsRepo;
  items: ItemsRepo;
  errors: ErrorsRepo;
  clusters: ClustersRepo;
  intelligence: IntelligenceRepo;
}
