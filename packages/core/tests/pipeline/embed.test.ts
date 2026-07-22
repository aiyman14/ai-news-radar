import { describe, expect, it } from "vitest";
import { embeddingText, runEmbedStage } from "../../src/pipeline/embed";
import { createInMemoryRepositories } from "../../src/db/repositories/memory";
import { createFakeEmbeddings } from "../../src/providers/fake";
import { EMBEDDING_DIMENSIONS, ProviderError, type EmbeddingsProvider } from "../../src/providers/llm";
import { err, ok } from "../../src/types/result";
import type { NormalizedDraft } from "../../src/types/item";
import type { Logger } from "../../src/adapters/types";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function draft(overrides: Partial<NormalizedDraft> = {}): NormalizedDraft {
  return {
    externalId: "x",
    canonicalUrl: null,
    title: "A story title",
    bodyText: "Body text here.",
    bodyHtml: null,
    imageUrl: null,
    media: {},
    authorName: null,
    publishedAt: null,
    language: "en",
    tags: [],
    entities: [],
    engagement: null,
    contentHash: "0".repeat(64),
    kind: "news",
    kindConfidence: 0.5,
    score: 1,
    ...overrides,
  };
}

function seedItems(count: number) {
  const { repos, stores } = createInMemoryRepositories([]);
  for (let i = 0; i < count; i++) {
    stores.normalizedItems.push({
      id: `item-${String(i).padStart(3, "0")}`,
      rawItemId: `raw-${i}`,
      sourceId: "src",
      draft: draft({ externalId: `ext-${i}`, title: `Story number ${i}` }),
      fetchedAt: new Date().toISOString(),
      clusterId: null,
    });
  }
  return { repos, stores };
}

describe("embeddingText", () => {
  it("prefers llm_summary over body, falls back to title alone", () => {
    expect(embeddingText({ title: "T", llmSummary: "LLM sum", bodyText: "body" })).toBe(
      "T\nLLM sum",
    );
    expect(embeddingText({ title: "T", llmSummary: null, bodyText: "body" })).toBe("T\nbody");
    expect(embeddingText({ title: "T", llmSummary: null, bodyText: null })).toBe("T");
  });

  it("truncates long bodies", () => {
    const text = embeddingText({ title: "T", llmSummary: null, bodyText: "x".repeat(10_000) });
    expect(text.length).toBeLessThan(1_100);
  });
});

describe("runEmbedStage", () => {
  it("skips gracefully when no provider is configured", async () => {
    const { repos, stores } = seedItems(2);
    const result = await runEmbedStage({
      intelligence: repos.intelligence,
      embeddings: null,
      logger: silentLogger,
    });
    expect(result).toEqual({ skipped: true, itemsConsidered: 0, itemsEmbedded: 0, itemsFailed: 0 });
    expect(stores.normalizedItems.every((n) => (n.embedding ?? null) === null)).toBe(true);
  });

  it("embeds unembedded items (1024 dims), idempotent on re-run (0 embedded)", async () => {
    const { repos, stores } = seedItems(3);
    const deps = {
      intelligence: repos.intelligence,
      embeddings: createFakeEmbeddings(),
      logger: silentLogger,
    };
    const first = await runEmbedStage(deps);
    expect(first).toEqual({ skipped: false, itemsConsidered: 3, itemsEmbedded: 3, itemsFailed: 0 });
    for (const n of stores.normalizedItems) {
      expect(n.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    }
    const second = await runEmbedStage(deps);
    expect(second).toEqual({ skipped: false, itemsConsidered: 0, itemsEmbedded: 0, itemsFailed: 0 });
  });

  it("batches requests (batchSize respected, one provider call per batch)", async () => {
    const { repos } = seedItems(5);
    const batchSizes: number[] = [];
    const fake = createFakeEmbeddings();
    const counting: EmbeddingsProvider = {
      name: "counting",
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(texts) {
        batchSizes.push(texts.length);
        return fake.embed(texts);
      },
    };
    const result = await runEmbedStage(
      { intelligence: repos.intelligence, embeddings: counting, logger: silentLogger },
      { batchSize: 2 },
    );
    expect(result.itemsEmbedded).toBe(5);
    expect(batchSizes).toEqual([2, 2, 1]);
  });

  it("a failed batch is contained: its items count failed, later batches proceed, retry next run", async () => {
    const { repos, stores } = seedItems(4);
    let call = 0;
    const fake = createFakeEmbeddings();
    const flaky: EmbeddingsProvider = {
      name: "flaky",
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(texts) {
        call += 1;
        if (call === 1) return err(new ProviderError("flaky", "http_error", "HTTP 500", 500));
        return fake.embed(texts);
      },
    };
    const result = await runEmbedStage(
      { intelligence: repos.intelligence, embeddings: flaky, logger: silentLogger },
      { batchSize: 2 },
    );
    expect(result.itemsEmbedded).toBe(2);
    expect(result.itemsFailed).toBe(2);
    expect(stores.normalizedItems.filter((n) => (n.embedding ?? null) === null)).toHaveLength(2);
  });

  it("caps per run (maxItems)", async () => {
    const { repos } = seedItems(5);
    const deps = {
      intelligence: repos.intelligence,
      embeddings: createFakeEmbeddings(),
      logger: silentLogger,
    };
    const first = await runEmbedStage(deps, { maxItems: 3 });
    expect(first.itemsEmbedded).toBe(3);
    const second = await runEmbedStage(deps, { maxItems: 3 });
    expect(second.itemsEmbedded).toBe(2);
  });
});
