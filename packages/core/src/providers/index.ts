import { RuleBasedSummarizer, type Summarizer } from "./summarizer";
import { DictionaryTagger, type Tagger } from "./tagger";
import type { EmbeddingsProvider, GenerationProvider } from "./llm";
import { createAnthropicGeneration } from "./anthropic";
import { createOpenAIEmbeddings, createOpenAIGeneration } from "./openai";
import { createVoyageEmbeddings } from "./voyage";
import { createFakeEmbeddings, createFakeGeneration } from "./fake";

export interface Providers {
  summarizer: Summarizer;
  tagger: Tagger;
}

/**
 * Free deterministic providers (rule-based summarizer + dictionary tagger)
 * — the pre-LLM defaults; the ingest normalize/enrich path keeps using
 * them regardless of LLM configuration.
 */
export function getProviders(_env: Record<string, string | undefined>): Providers {
  return {
    summarizer: new RuleBasedSummarizer(),
    tagger: new DictionaryTagger(),
  };
}

// ---------------------------------------------------------------------------
// LLM provider selection
// ---------------------------------------------------------------------------

/**
 * What resolveProviders() hands back: a slot per interface, null when that
 * capability is unconfigured. Callers must treat null as "skip gracefully"
 * (stages log a notice and do nothing) — a null provider is an accepted
 * operating state, not an error.
 */
export interface ResolvedProviders {
  generation: GenerationProvider | null;
  embeddings: EmbeddingsProvider | null;
  /** Why a slot is null, one line per null slot — callers log these. */
  notices: string[];
}

/**
 * The ONLY place provider env vars are read (swapping providers is config,
 * not a refactor). Selection:
 *
 *   LLM_PROVIDER        = anthropic | openai | fake   (unset → generation null)
 *   EMBEDDINGS_PROVIDER = voyage    | openai | fake   (unset → embeddings null)
 *
 * Keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, VOYAGE_API_KEY. A provider
 * selected without its key resolves to null (with a notice) — never a
 * crash. `fake` needs no key. Model overrides: LLM_MODEL_BULK,
 * LLM_MODEL_DRAFT, EMBEDDINGS_MODEL (defaults live in each impl).
 * Key VALUES are never logged; notices name the variable, not its content.
 */
export function resolveProviders(env: Record<string, string | undefined>): ResolvedProviders {
  const notices: string[] = [];

  const generation = ((): GenerationProvider | null => {
    const selected = env.LLM_PROVIDER?.trim();
    const models = { bulkModel: env.LLM_MODEL_BULK, draftModel: env.LLM_MODEL_DRAFT };
    switch (selected || undefined) {
      case undefined:
        notices.push("LLM_PROVIDER unset — generation disabled (enrich stage skips)");
        return null;
      case "fake":
        return createFakeGeneration();
      case "anthropic":
        if (!env.ANTHROPIC_API_KEY) {
          notices.push("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY unset — generation disabled");
          return null;
        }
        return createAnthropicGeneration({ apiKey: env.ANTHROPIC_API_KEY, ...models });
      case "openai":
        if (!env.OPENAI_API_KEY) {
          notices.push("LLM_PROVIDER=openai but OPENAI_API_KEY unset — generation disabled");
          return null;
        }
        return createOpenAIGeneration({ apiKey: env.OPENAI_API_KEY, ...models });
      default:
        notices.push(
          `LLM_PROVIDER='${selected}' is not one of anthropic|openai|fake — generation disabled`,
        );
        return null;
    }
  })();

  const embeddings = ((): EmbeddingsProvider | null => {
    const selected = env.EMBEDDINGS_PROVIDER?.trim();
    const model = env.EMBEDDINGS_MODEL;
    switch (selected || undefined) {
      case undefined:
        notices.push("EMBEDDINGS_PROVIDER unset — embeddings disabled (embed stage skips)");
        return null;
      case "fake":
        return createFakeEmbeddings();
      case "voyage":
        if (!env.VOYAGE_API_KEY) {
          notices.push("EMBEDDINGS_PROVIDER=voyage but VOYAGE_API_KEY unset — embeddings disabled");
          return null;
        }
        return createVoyageEmbeddings({ apiKey: env.VOYAGE_API_KEY, model });
      case "openai":
        if (!env.OPENAI_API_KEY) {
          notices.push("EMBEDDINGS_PROVIDER=openai but OPENAI_API_KEY unset — embeddings disabled");
          return null;
        }
        return createOpenAIEmbeddings({ apiKey: env.OPENAI_API_KEY, model });
      default:
        notices.push(
          `EMBEDDINGS_PROVIDER='${selected}' is not one of voyage|openai|fake — embeddings disabled`,
        );
        return null;
    }
  })();

  return { generation, embeddings, notices };
}

export type { Summarizer, Tagger };
export { RuleBasedSummarizer, DictionaryTagger };

// LLM contracts + implementations
export {
  EMBEDDING_DIMENSIONS,
  DEFAULT_MAX_TOKENS,
  ProviderError,
  fitDimensions,
  type EmbeddingsProvider,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type GenerationUsage,
  type ModelTier,
  type ProviderErrorCode,
} from "./llm";
export {
  createAnthropicGeneration,
  ANTHROPIC_DEFAULT_BULK_MODEL,
  ANTHROPIC_DEFAULT_DRAFT_MODEL,
  type AnthropicConfig,
} from "./anthropic";
export {
  createOpenAIGeneration,
  createOpenAIEmbeddings,
  OPENAI_DEFAULT_BULK_MODEL,
  OPENAI_DEFAULT_DRAFT_MODEL,
  OPENAI_DEFAULT_EMBEDDINGS_MODEL,
  type OpenAIGenerationConfig,
  type OpenAIEmbeddingsConfig,
} from "./openai";
export { createVoyageEmbeddings, VOYAGE_DEFAULT_MODEL, type VoyageConfig } from "./voyage";
export {
  createFakeGeneration,
  createFakeEmbeddings,
  fakeEmbedding,
  fakeGenerationSeed,
} from "./fake";
