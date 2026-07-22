import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClusterableItem, ClusterPatch } from "../../types/item";
import type { ClustersRepo } from "./types";

/**
 * Supabase ClustersRepo — dumb CRUD over story_clusters +
 * normalized_items.cluster_id. All clustering *logic* lives in
 * pipeline/cluster.ts (see ClustersRepo doc in ./types.ts).
 *
 * Chunking mirrors items.ts: PostgREST `in()` filters travel in the URL, so
 * large id lists are chunked to stay under URI limits. Reads paginate with
 * range() because PostgREST caps responses (default max_rows=1000) — the
 * 72h window can exceed that on a full multi-source run.
 */
const ID_CHUNK = 100;
const PAGE_SIZE = 1000;

const ITEM_COLUMNS =
  "id, title, published_at, fetched_at, score, tags, entities, body_text, cluster_id";

interface ItemRow {
  id: string;
  title: string;
  published_at: string | null;
  fetched_at: string;
  score: number;
  tags: string[];
  entities: string[];
  body_text: string | null;
  cluster_id: string | null;
  /** pgvector text format "[0.1,…]" — selected only with withEmbeddings. */
  embedding?: string | null;
}

/** pgvector's text output "[0.1,0.2]" happens to be valid JSON. */
function parseVector(text: string | null | undefined): number[] | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "number")
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

function toClusterableItem(r: ItemRow): ClusterableItem {
  return {
    id: r.id,
    title: r.title,
    publishedAt: r.published_at ? new Date(r.published_at) : null,
    fetchedAt: new Date(r.fetched_at),
    score: Number(r.score),
    tags: r.tags ?? [],
    entities: r.entities ?? [],
    bodyText: r.body_text,
    clusterId: r.cluster_id,
    embedding: parseVector(r.embedding),
  };
}

function toClusterRow(patch: ClusterPatch) {
  return {
    representative_id: patch.representativeId,
    title: patch.title,
    summary: patch.summary,
    tags: patch.tags,
    entities: patch.entities,
    item_count: patch.itemCount,
    first_seen_at: patch.firstSeenAt.toISOString(),
    last_seen_at: patch.lastSeenAt.toISOString(),
    score: patch.score,
  };
}

export function createClustersRepo(client: SupabaseClient): ClustersRepo {
  return {
    async listClusterableItems(since, opts) {
      const columns = opts?.withEmbeddings ? `${ITEM_COLUMNS}, embedding` : ITEM_COLUMNS;
      const items: ClusterableItem[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client
          .from("normalized_items")
          .select(columns)
          .gte("fetched_at", since.toISOString())
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`normalized_items.listClusterable failed: ${error.message}`);
        const rows = (data ?? []) as unknown as ItemRow[];
        items.push(...rows.map(toClusterableItem));
        if (rows.length < PAGE_SIZE) break;
      }
      return items;
    },

    async listItemsByClusterIds(clusterIds) {
      const items: ClusterableItem[] = [];
      for (let i = 0; i < clusterIds.length; i += ID_CHUNK) {
        const chunk = clusterIds.slice(i, i + ID_CHUNK);
        const { data, error } = await client
          .from("normalized_items")
          .select(ITEM_COLUMNS)
          .in("cluster_id", chunk)
          .order("id", { ascending: true });
        if (error) throw new Error(`normalized_items.byClusterIds failed: ${error.message}`);
        items.push(...((data ?? []) as ItemRow[]).map(toClusterableItem));
      }
      return items;
    },

    async createCluster(patch) {
      const { data, error } = await client
        .from("story_clusters")
        .insert(toClusterRow(patch))
        .select("id")
        .single();
      if (error) throw new Error(`story_clusters.insert failed: ${error.message}`);
      return (data as { id: string }).id;
    },

    async updateCluster(clusterId, patch) {
      const { error } = await client
        .from("story_clusters")
        .update(toClusterRow(patch))
        .eq("id", clusterId);
      if (error) throw new Error(`story_clusters.update failed: ${error.message}`);
    },

    async assignItems(clusterId, itemIds) {
      for (let i = 0; i < itemIds.length; i += ID_CHUNK) {
        const chunk = itemIds.slice(i, i + ID_CHUNK);
        const { error } = await client
          .from("normalized_items")
          .update({ cluster_id: clusterId })
          .in("id", chunk);
        if (error) throw new Error(`normalized_items.assign failed: ${error.message}`);
      }
    },

    async deleteClusters(clusterIds) {
      for (let i = 0; i < clusterIds.length; i += ID_CHUNK) {
        const chunk = clusterIds.slice(i, i + ID_CHUNK);
        const { error } = await client.from("story_clusters").delete().in("id", chunk);
        if (error) throw new Error(`story_clusters.delete failed: ${error.message}`);
      }
    },
  };
}
