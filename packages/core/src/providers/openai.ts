import type { Result } from "../types/result";
import { err, ok } from "../types/result";
import {
  DEFAULT_MAX_TOKENS,
  EMBEDDING_DIMENSIONS,
  fitDimensions,
  ProviderError,
  type EmbeddingsProvider,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from "./llm";
import { isRecord, postJson } from "./http";

/**
 * OpenAI providers — plain fetch, Bearer auth, no SDK.
 *
 * Generation: POST /v1/chat/completions
 *   { model, max_tokens, messages: [{role:"system"},{role:"user"}] }
 *   reads choices[0].message.content, usage.{prompt_tokens,completion_tokens}
 *   tiers: bulk → gpt-4o-mini, draft → gpt-4o (reserved; env-overridable).
 *
 * Embeddings: POST /v1/embeddings
 *   { model: text-embedding-3-small, input: [...], dimensions: 1024 }
 *   — 3-small supports native dimension shortening, so the API itself emits
 *   the column's 1024 dims; fitDimensions is a belt-and-braces guarantee.
 *   Rows are re-ordered by their `index` field (the API preserves order,
 *   but the contract is positional — don't rely on it silently).
 */
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_DEFAULT_BULK_MODEL = "gpt-4o-mini";
export const OPENAI_DEFAULT_DRAFT_MODEL = "gpt-4o";
export const OPENAI_DEFAULT_EMBEDDINGS_MODEL = "text-embedding-3-small";

export interface OpenAIGenerationConfig {
  apiKey: string;
  bulkModel?: string;
  draftModel?: string;
  timeoutMs?: number;
}

export function createOpenAIGeneration(config: OpenAIGenerationConfig): GenerationProvider {
  const models = {
    bulk: config.bulkModel ?? OPENAI_DEFAULT_BULK_MODEL,
    draft: config.draftModel ?? OPENAI_DEFAULT_DRAFT_MODEL,
  };

  return {
    name: "openai",

    async generate(request: GenerationRequest): Promise<Result<GenerationResult, ProviderError>> {
      const model = models[request.tier];
      const result = await postJson({
        provider: "openai",
        url: OPENAI_CHAT_URL,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: {
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS[request.tier],
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
        },
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) return result;

      const data = result.value;
      if (!isRecord(data) || !Array.isArray(data.choices)) {
        return err(new ProviderError("openai", "bad_response", "missing choices[] in response"));
      }
      const first: unknown = data.choices[0];
      const message = isRecord(first) && isRecord(first.message) ? first.message : null;
      if (!message || typeof message.content !== "string") {
        return err(
          new ProviderError(
            "openai",
            "bad_response",
            "choices[0].message.content missing or not a string",
          ),
        );
      }
      const usage = isRecord(data.usage) ? data.usage : {};
      return ok({
        text: message.content,
        model: typeof data.model === "string" ? data.model : model,
        usage: {
          inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
          outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
        },
      });
    },
  };
}

export interface OpenAIEmbeddingsConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export function createOpenAIEmbeddings(config: OpenAIEmbeddingsConfig): EmbeddingsProvider {
  const model = config.model ?? OPENAI_DEFAULT_EMBEDDINGS_MODEL;

  return {
    name: "openai",
    dimensions: EMBEDDING_DIMENSIONS,

    async embed(texts: string[]): Promise<Result<number[][], ProviderError>> {
      if (texts.length === 0) return ok([]);
      const result = await postJson({
        provider: "openai",
        url: OPENAI_EMBEDDINGS_URL,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: { model, input: texts, dimensions: EMBEDDING_DIMENSIONS },
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) return result;
      return parseEmbeddingsResponse("openai", result.value, texts.length);
    },
  };
}

/**
 * Shared parser for the OpenAI-style embeddings shape ({data:[{index,
 * embedding}]}) — Voyage uses the same envelope. Sorts by index and forces
 * every vector to the column's dimensionality.
 */
export function parseEmbeddingsResponse(
  provider: string,
  data: unknown,
  expectedCount: number,
): Result<number[][], ProviderError> {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return err(new ProviderError(provider, "bad_response", "missing data[] in response"));
  }
  const rows: Array<{ index: number; embedding: number[] }> = [];
  for (const entry of data.data as unknown[]) {
    if (
      !isRecord(entry) ||
      typeof entry.index !== "number" ||
      !Array.isArray(entry.embedding) ||
      !entry.embedding.every((v) => typeof v === "number")
    ) {
      return err(new ProviderError(provider, "bad_response", "malformed embedding entry"));
    }
    rows.push({ index: entry.index, embedding: entry.embedding as number[] });
  }
  if (rows.length !== expectedCount) {
    return err(
      new ProviderError(
        provider,
        "bad_response",
        `expected ${expectedCount} embeddings, got ${rows.length}`,
      ),
    );
  }
  rows.sort((a, b) => a.index - b.index);
  return ok(rows.map((r) => fitDimensions(r.embedding)));
}
