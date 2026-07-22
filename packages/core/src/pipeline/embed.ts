import type { EmbeddableItem } from "../types/item";
import type { EmbedStageResult } from "../types/result";
import type { IntelligenceRepo } from "../db/repositories/types";
import type { Logger } from "../adapters/types";
import type { EmbeddingsProvider } from "../providers/llm";
import { ENRICH_WINDOW_HOURS, DEFAULT_LLM_MAX_ITEMS_PER_RUN } from "./enrich";

/**
 * Embedding stage — POST-PERSIST, runs after enrich (so fresh
 * llm_summary text is available to embed) on the same pattern:
 * nullable provider → graceful skip; `embedding is null` keys the backlog
 * (the row is the cache); maxItems cap-and-continue; repo failures throw
 * and are contained by the caller.
 *
 * Requests are batched (EMBED_BATCH_SIZE, ~64 texts/call). A failed batch
 * counts its items in itemsFailed and the stage continues with the next
 * batch — those items stay unembedded and are retried next run.
 */
export const EMBED_WINDOW_HOURS = ENRICH_WINDOW_HOURS;
export const EMBED_BATCH_SIZE = 64;
/** Body fallback (unenriched items) is truncated to this many chars. */
export const EMBED_BODY_MAX_CHARS = 1000;

/**
 * The text an item is embedded as (pure): title + the best available
 * summary (LLM summary when enriched, else a body prefix). Title alone
 * still embeds fine for link-only items.
 */
export function embeddingText(item: Pick<EmbeddableItem, "title" | "llmSummary" | "bodyText">): string {
  const summary = item.llmSummary?.trim() || (item.bodyText ?? "").trim().slice(0, EMBED_BODY_MAX_CHARS);
  return summary ? `${item.title}\n${summary}` : item.title;
}

export interface EmbedStageDeps {
  intelligence: IntelligenceRepo;
  /** null = unconfigured → the stage skips gracefully. */
  embeddings: EmbeddingsProvider | null;
  logger: Logger;
  /** Injectable clock (determinism) — defaults to wall clock. */
  now?: () => Date;
}

export interface EmbedStageOptions {
  windowHours?: number;
  /** Budget cap (LLM_MAX_ITEMS_PER_RUN). Cap-and-continue, never fail. */
  maxItems?: number;
  /** Backfill mode (--reembed): sweep all unembedded items, ignore the window. */
  backfill?: boolean;
  batchSize?: number;
}

/**
 * The post-enrich embedding stage. Safe to re-run: embedded items never
 * re-qualify, so a second run over unchanged inputs embeds 0.
 *
 * Throws on repo failure — the CALLER contains it (see runIngest).
 */
export async function runEmbedStage(
  deps: EmbedStageDeps,
  opts: EmbedStageOptions = {},
): Promise<EmbedStageResult> {
  const { intelligence, embeddings, logger } = deps;
  const now = deps.now ?? (() => new Date());

  if (embeddings === null) {
    logger.info("embed stage skipped: no embeddings provider configured (set EMBEDDINGS_PROVIDER)");
    return { skipped: true, itemsConsidered: 0, itemsEmbedded: 0, itemsFailed: 0 };
  }

  const windowHours = opts.windowHours ?? EMBED_WINDOW_HOURS;
  const maxItems = opts.maxItems ?? DEFAULT_LLM_MAX_ITEMS_PER_RUN;
  const batchSize = opts.batchSize ?? EMBED_BATCH_SIZE;
  const since = opts.backfill ? new Date(0) : new Date(now().getTime() - windowHours * 3_600_000);

  const items = await intelligence.listEmbeddableItems(since, maxItems);
  const result: EmbedStageResult = {
    skipped: false,
    itemsConsidered: items.length,
    itemsEmbedded: 0,
    itemsFailed: 0,
  };

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const embedded = await embeddings.embed(batch.map(embeddingText));
    if (!embedded.ok) {
      result.itemsFailed += batch.length;
      logger.warn("embed: batch failed (items left unembedded)", {
        batchStart: i,
        batchSize: batch.length,
        code: embedded.error.code,
        message: embedded.error.message,
      });
      continue;
    }
    await intelligence.saveEmbeddings(
      batch.map((item, j) => ({ id: item.id, embedding: embedded.value[j]! })),
    );
    result.itemsEmbedded += batch.length;
  }

  logger.info("embed stage done", { ...result, provider: embeddings.name });
  return result;
}
