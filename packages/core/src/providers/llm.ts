import type { Result } from "../types/result";

/**
 * Provider-agnostic LLM contracts.
 *
 * Two interfaces, three implementations each:
 *   GenerationProvider  — anthropic | openai | fake
 *   EmbeddingsProvider  — voyage   | openai | fake
 *
 * Conventions (mirroring the adapter contract in adapters/types.ts):
 *  - Expected failures (HTTP errors, timeouts, unparseable responses) are
 *    Result values (`err(ProviderError)`), NEVER throws. Callers decide how
 *    to contain them (stages record the failure and continue).
 *  - Providers are constructed with their config (key, models) once;
 *    selection from env happens ONLY in resolveProviders() — callers never
 *    read provider env vars themselves.
 *  - NEVER log key values. ProviderError messages carry status/code only.
 */

/**
 * Model tier requested for a generation call. Providers map tiers to
 * concrete models (env-overridable via LLM_MODEL_BULK / LLM_MODEL_DRAFT):
 *  - "bulk"  — cheap model for per-item enrichment (Haiku / gpt-4o-mini).
 *  - "draft" — top model, reserved for future long-form generation
 *    features (Opus / gpt-4o).
 * The FAKE provider also uses the tier to shape its deterministic output
 * (bulk → enrichment JSON, draft → long-form analysis JSON).
 */
export type ModelTier = "bulk" | "draft";

export interface GenerationRequest {
  /** System prompt (instructions; item text never goes here). */
  system: string;
  /** User prompt. Untrusted item text is embedded here as marked DATA. */
  prompt: string;
  tier: ModelTier;
  /** Output cap; defaults per tier (bulk 1024, draft 4096). */
  maxTokens?: number;
}

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerationResult {
  /** Raw model text (callers parse JSON out of it where expected). */
  text: string;
  /** Concrete model that served the call. */
  model: string;
  usage: GenerationUsage;
}

export interface GenerationProvider {
  /** Selection name: "anthropic" | "openai" | "fake". */
  readonly name: string;
  generate(request: GenerationRequest): Promise<Result<GenerationResult, ProviderError>>;
}

/**
 * Embedding dimensionality — matches the vector(1024) column in the
 * schema. voyage-3.5-lite emits 1024 natively; text-embedding-3-small is
 * requested with dimensions=1024 (supported native shortening). Any
 * provider drift is corrected by fitDimensions (truncate-or-pad, then
 * re-normalize) so the column never sees a wrong-sized vector.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingsProvider {
  /** Selection name: "voyage" | "openai" | "fake". */
  readonly name: string;
  /** Always EMBEDDING_DIMENSIONS — kept on the interface for assertions. */
  readonly dimensions: number;
  /** One vector per input text, same order. All-or-nothing per batch. */
  embed(texts: string[]): Promise<Result<number[][], ProviderError>>;
}

export type ProviderErrorCode =
  | "http_error" // non-2xx that isn't retryable (or retry exhausted)
  | "timeout" // request exceeded the deadline (after one retry)
  | "network" // fetch itself failed (after one retry)
  | "bad_response"; // 2xx but the body didn't match the API shape

/**
 * Typed provider failure — the ProviderError equivalent of IngestError.
 * Carried as a Result value; recorded to source_errors by pipeline stages
 * (phase 'enrich'/'embed'). Message must never contain key material.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(provider: string, code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

/** Default output caps per tier (overridable per request). */
export const DEFAULT_MAX_TOKENS: Record<ModelTier, number> = {
  bulk: 1024,
  draft: 4096,
};

/**
 * Force a vector to exactly `dims` dimensions: truncate or zero-pad, then
 * L2-normalize (so cosine similarity stays meaningful after padding).
 * A zero vector normalizes to zero (never divide by 0).
 */
export function fitDimensions(vector: number[], dims: number = EMBEDDING_DIMENSIONS): number[] {
  const fitted =
    vector.length === dims
      ? [...vector]
      : vector.length > dims
        ? vector.slice(0, dims)
        : [...vector, ...new Array<number>(dims - vector.length).fill(0)];
  const norm = Math.sqrt(fitted.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? fitted : fitted.map((v) => v / norm);
}
