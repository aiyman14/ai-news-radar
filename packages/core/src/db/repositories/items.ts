import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemsRepo } from "./types";

/**
 * PostgREST `in()` filters travel in the URL query string; large feeds
 * overflow the server's URI limit. A fixed id-count chunk is NOT enough —
 * rss-deepmind's URL-shaped ids are so long that 100 of them still overflow
 * (live failure, 2026-07-07). Chunk by cumulative ENCODED length instead,
 * with a count cap as belt-and-braces.
 */
const FIND_EXISTING_MAX_CHARS = 6_000; // encoded chars per in() filter — well under ~8k URI limits
const FIND_EXISTING_MAX_IDS = 100;

function* chunkByBudget(ids: string[]): Generator<string[]> {
  let chunk: string[] = [];
  let chars = 0;
  for (const id of ids) {
    const len = encodeURIComponent(id).length + 3; // +separators/quotes
    if (chunk.length > 0 && (chars + len > FIND_EXISTING_MAX_CHARS || chunk.length >= FIND_EXISTING_MAX_IDS)) {
      yield chunk;
      chunk = [];
      chars = 0;
    }
    chunk.push(id);
    chars += len;
  }
  if (chunk.length > 0) yield chunk;
}

export function createItemsRepo(client: SupabaseClient): ItemsRepo {
  return {
    async findExistingExternalIds(sourceId, externalIds) {
      const found = new Set<string>();
      for (const chunk of chunkByBudget(externalIds)) {
        const { data, error } = await client
          .from("raw_items")
          .select("external_id")
          .eq("source_id", sourceId)
          .in("external_id", chunk);
        if (error) throw new Error(`raw_items.findExisting failed: ${error.message}`);
        for (const r of (data ?? []) as Array<{ external_id: string }>) found.add(r.external_id);
      }
      return found;
    },

    async insertItems({ runId, source, items, fetchedAt }) {
      if (items.length === 0) return 0;

      // 1) raw_items — keep the raw payload (reprocessing hedge).
      const rawRows = items.map(({ raw, draft }) => ({
        run_id: runId,
        source_id: source.id,
        external_id: raw.externalId,
        fetched_at: fetchedAt.toISOString(),
        payload: raw.payload,
        content_hash: draft.contentHash,
      }));
      const { data: insertedRaw, error: rawError } = await client
        .from("raw_items")
        .insert(rawRows)
        .select("id, external_id");
      if (rawError) throw new Error(`raw_items.insert failed: ${rawError.message}`);
      const rawIdByExternal = new Map(
        ((insertedRaw ?? []) as Array<{ id: string; external_id: string }>).map((r) => [
          r.external_id,
          r.id,
        ]),
      );

      // 2) normalized_items referencing the raw rows.
      const normalizedRows = items.map(({ raw, draft }) => ({
        raw_item_id: rawIdByExternal.get(raw.externalId) ?? null,
        source_id: source.id,
        source_type: source.type,
        source_name: source.name,
        external_id: draft.externalId,
        canonical_url: draft.canonicalUrl,
        title: draft.title,
        body_text: draft.bodyText,
        body_html: draft.bodyHtml,
        image_url: draft.imageUrl,
        media: draft.media,
        author_name: draft.authorName,
        published_at: draft.publishedAt?.toISOString() ?? null,
        fetched_at: fetchedAt.toISOString(),
        language: draft.language,
        tags: draft.tags,
        entities: draft.entities,
        engagement: draft.engagement,
        content_hash: draft.contentHash,
        kind: draft.kind,
        kind_confidence: draft.kindConfidence,
        score: draft.score,
      }));
      const { error: normError } = await client.from("normalized_items").insert(normalizedRows);
      if (normError) throw new Error(`normalized_items.insert failed: ${normError.message}`);

      return normalizedRows.length;
    },
  };
}
