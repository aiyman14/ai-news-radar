import type { Result } from "../types/result";
import { err, ok } from "../types/result";
import {
  DEFAULT_MAX_TOKENS,
  ProviderError,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from "./llm";
import { isRecord, postJson } from "./http";

/**
 * Anthropic (Claude) GenerationProvider — plain fetch against the Messages
 * API, no SDK dependency (one endpoint doesn't justify one).
 *
 *   POST https://api.anthropic.com/v1/messages
 *   headers: x-api-key, anthropic-version: 2023-06-01
 *   body:    { model, max_tokens, system, messages: [{role:"user",content}] }
 *   reads:   content[0].text, usage.{input_tokens,output_tokens}
 *
 * Model tiers (env-overridable in resolveProviders):
 *   bulk  → claude-haiku-4-5   (per-item enrichment)
 *   draft → claude-opus-4-8    (reserved high-quality tier)
 */
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_DEFAULT_BULK_MODEL = "claude-haiku-4-5";
export const ANTHROPIC_DEFAULT_DRAFT_MODEL = "claude-opus-4-8";

export interface AnthropicConfig {
  apiKey: string;
  bulkModel?: string;
  draftModel?: string;
  timeoutMs?: number;
}

export function createAnthropicGeneration(config: AnthropicConfig): GenerationProvider {
  const models = {
    bulk: config.bulkModel ?? ANTHROPIC_DEFAULT_BULK_MODEL,
    draft: config.draftModel ?? ANTHROPIC_DEFAULT_DRAFT_MODEL,
  };

  return {
    name: "anthropic",

    async generate(request: GenerationRequest): Promise<Result<GenerationResult, ProviderError>> {
      const model = models[request.tier];
      const result = await postJson({
        provider: "anthropic",
        url: ANTHROPIC_API_URL,
        headers: { "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body: {
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS[request.tier],
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
        },
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) return result;

      const data = result.value;
      if (!isRecord(data) || !Array.isArray(data.content)) {
        return err(new ProviderError("anthropic", "bad_response", "missing content[] in response"));
      }
      const first: unknown = data.content[0];
      if (!isRecord(first) || typeof first.text !== "string") {
        return err(
          new ProviderError("anthropic", "bad_response", "content[0].text missing or not a string"),
        );
      }
      const usage = isRecord(data.usage) ? data.usage : {};
      return ok({
        text: first.text,
        model: typeof data.model === "string" ? data.model : model,
        usage: {
          inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
        },
      });
    },
  };
}
