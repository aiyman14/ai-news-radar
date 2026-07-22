import type { NormalizedDraft, RawItem } from "../types/item";

/**
 * Exact-duplicate detection (scaffold scope).
 * Two layers:
 *  1. externalId against rows already in the DB (the unique
 *     (source_id, external_id) key is the backstop) and within the batch.
 *  2. content_hash within the batch (same content under two ids).
 * Near-duplicate (trigram/Jaccard) dedup across sources is future work;
 * util/shingle.ts + util/jaccard.ts are the building blocks.
 */

export interface DedupInput {
  raw: RawItem;
  draft: NormalizedDraft;
}

export interface DedupOutcome {
  fresh: DedupInput[];
  duplicates: DedupInput[];
}

export function partitionNew(
  items: DedupInput[],
  existingExternalIds: ReadonlySet<string>,
): DedupOutcome {
  const fresh: DedupInput[] = [];
  const duplicates: DedupInput[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  for (const item of items) {
    const id = item.raw.externalId;
    const hash = item.draft.contentHash;
    if (existingExternalIds.has(id) || seenIds.has(id) || seenHashes.has(hash)) {
      duplicates.push(item);
      continue;
    }
    seenIds.add(id);
    seenHashes.add(hash);
    fresh.push(item);
  }
  return { fresh, duplicates };
}
