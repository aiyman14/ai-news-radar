import { ok, type Result } from "../types/result";
import { sha256Hex } from "../util/hash";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingsProvider,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
  type ProviderError,
} from "./llm";

/**
 * Deterministic FAKE providers — power tests, --dry-run, and the
 * whole system while no API key exists. Zero network, zero randomness:
 * every output is a pure function of the input (via sha256), so re-running
 * converges and unit tests can assert exact values.
 *
 * Determinism scheme:
 *  - generation: seed = sha256(system + "\n" + prompt); the response is
 *    valid JSON whose SHAPE follows the request tier (bulk calls come from
 *    the enrich stage; the draft tier is the reserved high-quality slot),
 *    with the seed's first 8 hex chars woven into the text so distinct
 *    inputs are visibly distinct.
 *  - embeddings: each vector is 1024 floats expanded from sha256(text) by
 *    counter hashing, then L2-normalized. Same text → same vector; the
 *    vectors are effectively random directions, so semantic-similarity
 *    behavior is NOT meaningful with the fake (calibration needs live
 *    embeddings — documented in cluster.ts).
 *
 * The fake enrichment response deliberately carries ONLY a summary (no
 * kind/tags/entities): fake runs must never overwrite the deterministic
 * classifier's values on real local data. Kind/tag write-back paths are
 * unit-tested with scripted providers instead.
 */

const FAKE_POINT_COUNT = 4;

/** The deterministic seed the fake generation provider uses (test hook). */
export function fakeGenerationSeed(request: Pick<GenerationRequest, "system" | "prompt">): string {
  return sha256Hex(`${request.system}\n${request.prompt}`);
}

function fakeBulkResponse(seed: string): string {
  return JSON.stringify({
    summary: `[fake ${seed.slice(0, 8)}] Deterministic test summary generated without an LLM; content derives from the request hash.`,
  });
}

function fakeDraftResponse(seed: string): string {
  const tag = seed.slice(0, 8);
  return JSON.stringify({
    headline: `Deterministic fake analysis headline [fake ${tag}]`,
    key_points: Array.from(
      { length: FAKE_POINT_COUNT },
      (_, i) => `Point ${i + 1}: deterministic fake analysis copy (${tag}-${i + 1}).`,
    ),
    analysis: `Fake long-form analysis (${tag}): synthetic test output for the high-quality generation tier; replace with a real provider for meaningful text.`,
    notes: [
      `Deterministic fake output (seed ${tag}) — no claims are grounded.`,
      "Source note: every field is synthetic test copy.",
    ],
  });
}

export function createFakeGeneration(): GenerationProvider {
  return {
    name: "fake",

    async generate(request: GenerationRequest): Promise<Result<GenerationResult, ProviderError>> {
      const seed = fakeGenerationSeed(request);
      const text = request.tier === "draft" ? fakeDraftResponse(seed) : fakeBulkResponse(seed);
      return ok({
        text,
        model: `fake-${request.tier}`,
        usage: {
          inputTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
          outputTokens: Math.ceil(text.length / 4),
        },
      });
    },
  };
}

/**
 * Expand sha256(text) into a unit vector: hash (seed + counter) repeatedly,
 * mapping each output byte to [-1, 1], then L2-normalize. 32 bytes/hash ×
 * 32 hashes = 1024 dims.
 */
export function fakeEmbedding(text: string): number[] {
  const seed = sha256Hex(text);
  const values: number[] = [];
  for (let counter = 0; values.length < EMBEDDING_DIMENSIONS; counter++) {
    const block = sha256Hex(`${seed}:${counter}`);
    for (let i = 0; i + 2 <= block.length && values.length < EMBEDDING_DIMENSIONS; i += 2) {
      const byte = parseInt(block.slice(i, i + 2), 16);
      values.push((byte / 255) * 2 - 1);
    }
  }
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? values : values.map((v) => v / norm);
}

export function createFakeEmbeddings(): EmbeddingsProvider {
  return {
    name: "fake",
    dimensions: EMBEDDING_DIMENSIONS,

    async embed(texts: string[]): Promise<Result<number[][], ProviderError>> {
      return ok(texts.map(fakeEmbedding));
    },
  };
}
