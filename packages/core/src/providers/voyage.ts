import type { Result } from "../types/result";
import { ok } from "../types/result";
import { EMBEDDING_DIMENSIONS, type EmbeddingsProvider, type ProviderError } from "./llm";
import { postJson } from "./http";
import { parseEmbeddingsResponse } from "./openai";

/**
 * Voyage AI EmbeddingsProvider — plain fetch, Bearer auth.
 *
 *   POST https://api.voyageai.com/v1/embeddings
 *   { model: voyage-3.5-lite, input: [...] } → data[i].embedding
 *
 * voyage-3.5-lite emits 1024 dimensions natively — exactly the vector(1024)
 * column. The response envelope matches OpenAI's ({data:[{index,
 * embedding}]}), so parsing is shared; fitDimensions inside it guarantees
 * the column dimensionality even if a different Voyage model is configured
 * (truncate-or-pad + re-normalize, documented in llm.ts).
 */
export const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_DEFAULT_MODEL = "voyage-3.5-lite";

export interface VoyageConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export function createVoyageEmbeddings(config: VoyageConfig): EmbeddingsProvider {
  const model = config.model ?? VOYAGE_DEFAULT_MODEL;

  return {
    name: "voyage",
    dimensions: EMBEDDING_DIMENSIONS,

    async embed(texts: string[]): Promise<Result<number[][], ProviderError>> {
      if (texts.length === 0) return ok([]);
      const result = await postJson({
        provider: "voyage",
        url: VOYAGE_EMBEDDINGS_URL,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: { model, input: texts },
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) return result;
      return parseEmbeddingsResponse("voyage", result.value, texts.length);
    },
  };
}
