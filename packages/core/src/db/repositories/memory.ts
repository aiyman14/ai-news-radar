import { randomUUID } from "node:crypto";
import type {
  ClusterableItem,
  ClusterPatch,
  NormalizedDraft,
  RawItem,
} from "../../types/item";
import type { SourceConfig } from "../../types/source";
import type { RunStatus, RunTrigger } from "../../types/result";
import type { IngestPhase } from "../../errors";
import type { Repositories } from "./types";

/**
 * In-memory Repositories — powers unit tests and `--dry-run`.
 * Mirrors the Supabase implementations' observable behavior
 * (idempotency by (sourceId, externalId), run lifecycle, error records).
 */

export interface MemoryStores {
  sources: SourceConfig[];
  runs: Array<{
    id: string;
    trigger: RunTrigger;
    startedAt: string;
    finishedAt: string | null;
    status: RunStatus | "running";
    itemsFetched: number;
    itemsNew: number;
    itemsFailed: number;
    notes: string | null;
  }>;
  rawItems: Array<{ id: string; runId: string; sourceId: string; raw: RawItem }>;
  normalizedItems: Array<{
    id: string;
    rawItemId: string;
    sourceId: string;
    draft: NormalizedDraft;
    fetchedAt: string; // ISO — mirrors normalized_items.fetched_at
    clusterId: string | null;
    // LLM enrichment columns — optional so pre-existing fixtures need
    // no changes; absent means null/unprocessed, like the DB default.
    llmSummary?: string | null;
    llmEnrichedAt?: string | null;
    embedding?: number[] | null;
  }>;
  clusters: Array<{
    id: string;
    representativeId: string;
    title: string;
    summary: string | null;
    tags: string[];
    entities: string[];
    itemCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    score: number;
    createdAt: string;
    updatedAt: string; // mirrors the story_clusters_set_updated_at trigger
  }>;
  errors: Array<{
    runId: string | null;
    sourceId: string | null;
    phase: IngestPhase;
    message: string;
    detail?: unknown;
  }>;
}

export function createInMemoryRepositories(seedSources: SourceConfig[]): {
  repos: Repositories;
  stores: MemoryStores;
} {
  const stores: MemoryStores = {
    sources: [...seedSources],
    runs: [],
    rawItems: [],
    normalizedItems: [],
    clusters: [],
    errors: [],
  };

  const toClusterableItem = (
    entry: MemoryStores["normalizedItems"][number],
    withEmbeddings = false,
  ): ClusterableItem => ({
    id: entry.id,
    title: entry.draft.title,
    publishedAt: entry.draft.publishedAt,
    fetchedAt: new Date(entry.fetchedAt),
    score: entry.draft.score,
    tags: entry.draft.tags,
    entities: entry.draft.entities,
    bodyText: entry.draft.bodyText,
    clusterId: entry.clusterId,
    embedding: withEmbeddings ? (entry.embedding ?? null) : null,
  });

  const applyPatch = (cluster: MemoryStores["clusters"][number], patch: ClusterPatch) => {
    cluster.representativeId = patch.representativeId;
    cluster.title = patch.title;
    cluster.summary = patch.summary;
    cluster.tags = [...patch.tags];
    cluster.entities = [...patch.entities];
    cluster.itemCount = patch.itemCount;
    cluster.firstSeenAt = patch.firstSeenAt.toISOString();
    cluster.lastSeenAt = patch.lastSeenAt.toISOString();
    cluster.score = patch.score;
    cluster.updatedAt = new Date().toISOString();
  };

  const repos: Repositories = {
    sources: {
      async listEnabled() {
        return stores.sources.filter((s) => s.enabled);
      },
      async getBySlugs(slugs) {
        return stores.sources.filter((s) => slugs.includes(s.slug));
      },
    },

    runs: {
      async start(trigger) {
        const id = randomUUID();
        stores.runs.push({
          id,
          trigger,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          status: "running",
          itemsFetched: 0,
          itemsNew: 0,
          itemsFailed: 0,
          notes: null,
        });
        return id;
      },
      async finish(runId, patch) {
        const run = stores.runs.find((r) => r.id === runId);
        if (!run) throw new Error(`run ${runId} not found`);
        run.finishedAt = new Date().toISOString();
        run.status = patch.status;
        run.itemsFetched = patch.itemsFetched;
        run.itemsNew = patch.itemsNew;
        run.itemsFailed = patch.itemsFailed;
        run.notes = patch.notes ?? null;
      },
    },

    items: {
      async findExistingExternalIds(sourceId, externalIds) {
        const wanted = new Set(externalIds);
        return new Set(
          stores.rawItems
            .filter((r) => r.sourceId === sourceId && wanted.has(r.raw.externalId))
            .map((r) => r.raw.externalId),
        );
      },
      async insertItems({ runId, source, items, fetchedAt }) {
        for (const { raw, draft } of items) {
          const rawId = randomUUID();
          stores.rawItems.push({ id: rawId, runId, sourceId: source.id, raw });
          stores.normalizedItems.push({
            id: randomUUID(),
            rawItemId: rawId,
            sourceId: source.id,
            draft,
            fetchedAt: fetchedAt.toISOString(),
            clusterId: null,
          });
        }
        return items.length;
      },
    },

    clusters: {
      async listClusterableItems(since, opts) {
        return stores.normalizedItems
          .filter((n) => new Date(n.fetchedAt).getTime() >= since.getTime())
          .map((n) => toClusterableItem(n, opts?.withEmbeddings ?? false))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
      },
      async listItemsByClusterIds(clusterIds) {
        const wanted = new Set(clusterIds);
        return stores.normalizedItems
          .filter((n) => n.clusterId !== null && wanted.has(n.clusterId))
          .map((n) => toClusterableItem(n))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
      },
      async createCluster(patch) {
        const cluster = {
          id: randomUUID(),
          representativeId: "",
          title: "",
          summary: null as string | null,
          tags: [] as string[],
          entities: [] as string[],
          itemCount: 0,
          firstSeenAt: "",
          lastSeenAt: "",
          score: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        applyPatch(cluster, patch);
        stores.clusters.push(cluster);
        return cluster.id;
      },
      async updateCluster(clusterId, patch) {
        const cluster = stores.clusters.find((c) => c.id === clusterId);
        if (!cluster) throw new Error(`cluster ${clusterId} not found`);
        applyPatch(cluster, patch);
      },
      async assignItems(clusterId, itemIds) {
        const wanted = new Set(itemIds);
        for (const n of stores.normalizedItems) {
          if (wanted.has(n.id)) n.clusterId = clusterId;
        }
      },
      async deleteClusters(clusterIds) {
        const gone = new Set(clusterIds);
        stores.clusters = stores.clusters.filter((c) => !gone.has(c.id));
        // Mirror the FK's `on delete set null` (callers reassign first anyway).
        for (const n of stores.normalizedItems) {
          if (n.clusterId !== null && gone.has(n.clusterId)) n.clusterId = null;
        }
      },
    },

    intelligence: {
      async listEnrichableItems(since, limit) {
        return stores.normalizedItems
          .filter(
            (n) =>
              (n.llmEnrichedAt ?? null) === null &&
              new Date(n.fetchedAt).getTime() >= since.getTime(),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map((n) => ({
            id: n.id,
            title: n.draft.title,
            bodyText: n.draft.bodyText,
            kind: n.draft.kind,
            kindConfidence: n.draft.kindConfidence,
            tags: n.draft.tags,
            entities: n.draft.entities,
          }));
      },
      async saveEnrichments(updates) {
        for (const u of updates) {
          const entry = stores.normalizedItems.find((n) => n.id === u.id);
          if (!entry) throw new Error(`normalized item ${u.id} not found`);
          entry.llmSummary = u.llmSummary;
          entry.llmEnrichedAt = u.enrichedAt.toISOString();
          if (u.kind !== undefined) entry.draft.kind = u.kind;
          if (u.kindConfidence !== undefined) entry.draft.kindConfidence = u.kindConfidence;
          if (u.tags !== undefined) entry.draft.tags = u.tags;
          if (u.entities !== undefined) entry.draft.entities = u.entities;
        }
      },
      async listEmbeddableItems(since, limit) {
        return stores.normalizedItems
          .filter(
            (n) =>
              (n.embedding ?? null) === null &&
              new Date(n.fetchedAt).getTime() >= since.getTime(),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map((n) => ({
            id: n.id,
            title: n.draft.title,
            llmSummary: n.llmSummary ?? null,
            bodyText: n.draft.bodyText,
          }));
      },
      async saveEmbeddings(rows) {
        for (const row of rows) {
          const entry = stores.normalizedItems.find((n) => n.id === row.id);
          if (!entry) throw new Error(`normalized item ${row.id} not found`);
          entry.embedding = [...row.embedding];
        }
      },
    },

    errors: {
      async record(entry) {
        stores.errors.push(entry);
      },
    },
  };

  return { repos, stores };
}
