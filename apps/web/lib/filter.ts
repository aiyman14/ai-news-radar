import type { ItemCard } from "./item-card";

/**
 * Pure feed filtering — shared by the build-time pages and the browser-side
 * search page, so both agree on what a filter means. Input is assumed
 * already sorted (toItemCards); output preserves order.
 */
export interface FeedFilters {
  /** Every whitespace-separated term must appear in title/source/tags/entities. */
  q?: string;
  kinds?: string[];
  sourceId?: string;
  /** published_at within the last N hours (relative to `now`). */
  sinceHours?: number;
  hasImage?: boolean;
  clusteredOnly?: boolean;
  tag?: string;
  entity?: string;
}

export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function haystack(item: ItemCard): string {
  return `${item.title} ${item.source_name} ${item.tags.join(" ")} ${item.entities.join(" ")}`.toLowerCase();
}

export function filterItems(items: ItemCard[], f: FeedFilters, now = Date.now()): ItemCard[] {
  const terms = searchTerms(f.q);
  const kinds = f.kinds && f.kinds.length > 0 ? new Set(f.kinds) : null;
  const since = f.sinceHours && f.sinceHours > 0 ? now - f.sinceHours * 3_600_000 : null;
  const tag = f.tag?.toLowerCase();
  const entity = f.entity?.toLowerCase();

  return items.filter((item) => {
    if (kinds && !kinds.has(item.kind)) return false;
    if (f.sourceId && item.source_id !== f.sourceId) return false;
    if (since !== null) {
      if (!item.published_at || Date.parse(item.published_at) < since) return false;
    }
    if (f.hasImage && !item.image_url) return false;
    if (f.clusteredOnly && !item.cluster_id) return false;
    if (tag && !item.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (entity && !item.entities.some((e) => e.toLowerCase() === entity)) return false;
    if (terms.length > 0) {
      const text = haystack(item);
      for (const term of terms) if (!text.includes(term)) return false;
    }
    return true;
  });
}

export const FEED_PAGE_SIZE = 50;

export interface Page<T> {
  items: T[];
  page: number; // 1-based
  totalPages: number;
  total: number;
  hasMore: boolean;
}

export function paginate<T>(items: T[], page: number, pageSize = FEED_PAGE_SIZE): Page<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const from = (current - 1) * pageSize;
  return {
    items: items.slice(from, from + pageSize),
    page: current,
    totalPages,
    total,
    hasMore: current < totalPages,
  };
}
