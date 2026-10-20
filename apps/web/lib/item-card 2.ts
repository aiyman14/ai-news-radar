import type { Json, NormalizedItemRow, StoryClusterRow } from "@radar/core";

/**
 * The compact item shape every list renders (ItemRow) and the search index
 * ships to the browser. Deliberately body-less: the dashboard links out to
 * the source, it never reproduces articles.
 */
export interface ItemCard {
  id: string;
  title: string;
  canonical_url: string | null;
  image_url: string | null;
  kind: string;
  source_id: string;
  source_name: string;
  published_at: string | null;
  tags: string[];
  entities: string[];
  engagement: Record<string, Json> | null;
  cluster_id: string | null;
  /** item_count of the item's story (null when unclustered). */
  cluster_size: number | null;
}

function publishedMs(row: { published_at: string | null }): number {
  return row.published_at ? Date.parse(row.published_at) : Number.NEGATIVE_INFINITY;
}

/** `published_at desc nulls last`, ties broken by id for stable pages. */
export function sortByPublished<T extends { id: string; published_at: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => publishedMs(b) - publishedMs(a) || (a.id < b.id ? -1 : 1));
}

export function toItemCards(items: NormalizedItemRow[], clusters: StoryClusterRow[]): ItemCard[] {
  const sizes = new Map(clusters.map((c) => [c.id, c.item_count]));
  return sortByPublished(items.filter((i) => i.status === "active")).map((i) => {
    // A cluster pruned by retention leaves dangling ids — treat as unclustered
    // so no list links to a story page that doesn't exist.
    const clustered = i.cluster_id !== null && sizes.has(i.cluster_id);
    return {
      id: i.id,
      title: i.title,
      canonical_url: i.canonical_url,
      image_url: i.image_url,
      kind: i.kind,
      source_id: i.source_id,
      source_name: i.source_name,
      published_at: i.published_at,
      tags: i.tags,
      entities: i.entities,
      engagement: i.engagement,
      cluster_id: clustered ? i.cluster_id : null,
      cluster_size: clustered ? (sizes.get(i.cluster_id as string) ?? null) : null,
    };
  });
}
