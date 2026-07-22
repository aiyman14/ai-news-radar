import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmbeddableItem, EnrichableItem, EnrichmentUpdate } from "../../types/item";
import { isKind } from "../../types/item";
import type { IntelligenceRepo } from "./types";

/**
 * Supabase IntelligenceRepo — dumb CRUD over normalized_items' LLM columns
 * (llm_summary, llm_enriched_at, embedding). All enrichment/embedding
 * *logic* lives in pipeline/enrich.ts + pipeline/embed.ts (see
 * IntelligenceRepo doc in ./types.ts).
 *
 * Writes are per-row updates: PostgREST has no multi-row UPDATE with
 * per-row values, and both stages are capped (LLM_MAX_ITEMS_PER_RUN,
 * default 400) so the round-trip count is bounded by design.
 *
 * Embeddings travel as pgvector's text format '[0.1,0.2,…]' — PostgREST
 * casts it into vector(1024); number[] would be rejected.
 */

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function createIntelligenceRepo(client: SupabaseClient): IntelligenceRepo {
  return {
    async listEnrichableItems(since, limit) {
      const { data, error } = await client
        .from("normalized_items")
        .select("id, title, body_text, kind, kind_confidence, tags, entities")
        .is("llm_enriched_at", null)
        .eq("status", "active")
        .gte("fetched_at", since.toISOString())
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`normalized_items.listEnrichable failed: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): EnrichableItem => ({
          id: r.id as string,
          title: r.title as string,
          bodyText: (r.body_text as string | null) ?? null,
          kind: isKind(r.kind) ? r.kind : "news",
          kindConfidence: Number(r.kind_confidence ?? 0),
          tags: (r.tags as string[]) ?? [],
          entities: (r.entities as string[]) ?? [],
        }),
      );
    },

    async saveEnrichments(updates) {
      for (const u of updates) {
        const patch: Record<string, unknown> = {
          llm_summary: u.llmSummary,
          llm_enriched_at: u.enrichedAt.toISOString(),
        };
        if (u.kind !== undefined) patch.kind = u.kind;
        if (u.kindConfidence !== undefined) patch.kind_confidence = u.kindConfidence;
        if (u.tags !== undefined) patch.tags = u.tags;
        if (u.entities !== undefined) patch.entities = u.entities;
        const { error } = await client.from("normalized_items").update(patch).eq("id", u.id);
        if (error) throw new Error(`normalized_items.saveEnrichment failed: ${error.message}`);
      }
    },

    async listEmbeddableItems(since, limit) {
      const { data, error } = await client
        .from("normalized_items")
        .select("id, title, llm_summary, body_text")
        .is("embedding", null)
        .eq("status", "active")
        .gte("fetched_at", since.toISOString())
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`normalized_items.listEmbeddable failed: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): EmbeddableItem => ({
          id: r.id as string,
          title: r.title as string,
          llmSummary: (r.llm_summary as string | null) ?? null,
          bodyText: (r.body_text as string | null) ?? null,
        }),
      );
    },

    async saveEmbeddings(rows) {
      for (const row of rows) {
        const { error } = await client
          .from("normalized_items")
          .update({ embedding: toVectorLiteral(row.embedding) })
          .eq("id", row.id);
        if (error) throw new Error(`normalized_items.saveEmbedding failed: ${error.message}`);
      }
    },
  };
}
