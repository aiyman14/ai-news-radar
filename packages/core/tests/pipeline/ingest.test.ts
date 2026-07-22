import { describe, expect, it } from "vitest";
import { parseLlmMaxItems, runIngest } from "../../src/pipeline/index";
import { createInMemoryRepositories } from "../../src/db/repositories/memory";
import { getAdapter } from "../../src/adapters/registry";
import { createFakeEmbeddings, createFakeGeneration } from "../../src/providers/fake";
import { EMBEDDING_DIMENSIONS } from "../../src/providers/llm";
import type { SourceConfig } from "../../src/types/source";
import type { Logger } from "../../src/adapters/types";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const fakeSource: SourceConfig = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "fake-fixture",
  type: "fake",
  name: "Fake fixture source",
  url: null,
  config: {},
  trustScore: 5,
  defaultKindHint: "news",
  enabled: false, // disabled — runs only when explicitly named
};

// Uses type "hn" — a registry stub that always errors (a real "rss" source
// here would make these tests hit the network).
const stubSource: SourceConfig = {
  id: "00000000-0000-0000-0000-000000000002",
  slug: "hn-stub",
  type: "hn",
  name: "HN (stub)",
  url: "https://news.ycombinator.com",
  config: {},
  trustScore: 8,
  defaultKindHint: "news",
  enabled: true,
};

function deps(sources: SourceConfig[]) {
  const { repos, stores } = createInMemoryRepositories(sources);
  return {
    stores,
    deps: { repos, getAdapter, logger: silentLogger, env: {} },
  };
}

describe("runIngest (fake adapter, end-to-end against in-memory repos)", () => {
  it("writes a run, raw items, and normalized items with kind + image_url", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });

    expect(summary.status).toBe("success");
    expect(summary.itemsFetched).toBe(2);
    expect(summary.itemsNew).toBe(2);
    expect(summary.itemsFailed).toBe(0);

    expect(stores.runs).toHaveLength(1);
    expect(stores.runs[0]?.status).toBe("success");
    expect(stores.rawItems).toHaveLength(2);
    expect(stores.normalizedItems).toHaveLength(2);

    const drafts = stores.normalizedItems.map((n) => n.draft);
    const launch = drafts.find((d2) => d2.externalId === "fake-001");
    const tip = drafts.find((d2) => d2.externalId === "fake-002");

    // fixture 1: "releases" => launch; has an image; Anthropic entity found
    expect(launch?.kind).toBe("launch");
    expect(launch?.imageUrl).toBe("https://example.com/img/claude-5-hero.png");
    expect(launch?.entities).toContain("Anthropic");
    // fixture 2: "How to ..." => tip; image nullable
    expect(tip?.kind).toBe("tip");
    expect(tip?.imageUrl).toBeNull();
    // every draft carries a content hash and a score
    for (const d2 of drafts) {
      expect(d2.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(d2.score).toBeGreaterThan(0);
    }
  });

  it("is idempotent: a second run inserts zero new items", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });
    const second = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });

    expect(second.itemsFetched).toBe(2);
    expect(second.itemsNew).toBe(0);
    expect(second.sources[0]?.duplicates).toBe(2);
    expect(stores.normalizedItems).toHaveLength(2); // unchanged
  });

  it("records stub-adapter failures in source_errors and marks the run failed", async () => {
    const { deps: d, stores } = deps([stubSource]);
    const summary = await runIngest(d, { trigger: "cron" });

    expect(summary.status).toBe("failed"); // the only source failed, nothing inserted
    expect(stores.errors).toHaveLength(1);
    expect(stores.errors[0]?.phase).toBe("fetch");
    expect(stores.errors[0]?.message).toContain("not implemented");
    expect(stores.runs[0]?.status).toBe("failed");
  });

  it("marks the run partial when some sources succeed and some fail", async () => {
    const { deps: d } = deps([fakeSource, stubSource]);
    const summary = await runIngest(d, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture", "hn-stub"],
    });

    expect(summary.status).toBe("partial");
    expect(summary.itemsNew).toBe(2);
    expect(summary.itemsFailed).toBe(1);
  });

  it("respects limitPerSource", async () => {
    const { deps: d } = deps([fakeSource]);
    const summary = await runIngest(d, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture"],
      limitPerSource: 1,
    });
    expect(summary.itemsFetched).toBe(1);
    expect(summary.itemsNew).toBe(1);
  });

  it("runs the cluster stage post-persist (dissimilar fixtures stay singletons)", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });

    expect(summary.clusters).toEqual({
      itemsConsidered: 2,
      itemsAssigned: 0,
      clustersCreated: 0,
      clustersUpdated: 0,
      clustersMerged: 0,
    });
    expect(stores.clusters).toHaveLength(0);
    for (const n of stores.normalizedItems) expect(n.clusterId).toBeNull();
  });

  it("clusters a fixture item with a pre-existing near-dupe, idempotently across re-runs", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    // An earlier run left a differently-worded take on the fake-001 story.
    stores.normalizedItems.push({
      id: "pre-existing-neardupe",
      rawItemId: "raw-pre",
      sourceId: "some-other-source",
      draft: {
        externalId: "pre-001",
        canonicalUrl: null,
        title: "Anthropic releases Claude 5 with breakthrough coding capabilities",
        bodyText: null,
        bodyHtml: null,
        imageUrl: null,
        media: {},
        authorName: null,
        publishedAt: new Date("2026-07-05T15:00:00Z"),
        language: "en",
        tags: [],
        entities: ["Anthropic"],
        engagement: null,
        contentHash: "0".repeat(64),
        kind: "news",
        kindConfidence: 0.5,
        score: 1,
      },
      fetchedAt: new Date().toISOString(),
      clusterId: null,
    });

    const first = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });
    expect(first.clusters?.clustersCreated).toBe(1);
    expect(first.clusters?.itemsAssigned).toBe(2);
    expect(stores.clusters).toHaveLength(1);
    expect(stores.clusters[0]?.itemCount).toBe(2);
    // fake-002 (unrelated tip) stays a singleton
    const tip = stores.normalizedItems.find((n) => n.draft.externalId === "fake-002");
    expect(tip?.clusterId).toBeNull();

    // Re-run: no new items, no duplicate clusters, counts stable.
    const second = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });
    expect(second.clusters?.clustersCreated).toBe(0);
    expect(second.clusters?.itemsAssigned).toBe(0);
    expect(stores.clusters).toHaveLength(1);
  });

  it("contains a cluster-stage failure: items persist, error recorded, run still succeeds", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    d.repos.clusters.listClusterableItems = async () => {
      throw new Error("boom: simulated cluster-stage bug");
    };

    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });

    expect(summary.status).toBe("success"); // ingestion itself was fine
    expect(summary.itemsNew).toBe(2);
    expect(summary.clusters).toBeUndefined();
    expect(stores.normalizedItems).toHaveLength(2); // nothing lost
    expect(stores.errors).toHaveLength(1);
    expect(stores.errors[0]?.phase).toBe("cluster");
    expect(stores.errors[0]?.message).toContain("[cluster/stage_failed]");
    expect(stores.errors[0]?.sourceId).toBeNull();
    expect(stores.runs[0]?.notes).toBe("cluster stage failed");
  });

  it("skips enrich+embed with a notice when providers are unconfigured (env {})", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });

    expect(summary.status).toBe("success");
    expect(summary.enrich).toEqual({
      skipped: true,
      itemsConsidered: 0,
      itemsEnriched: 0,
      itemsFailed: 0,
    });
    expect(summary.embed?.skipped).toBe(true);
    // Unconfigured is an accepted state — never an error record.
    expect(stores.errors).toHaveLength(0);
    for (const n of stores.normalizedItems) {
      expect(n.llmSummary ?? null).toBeNull();
      expect(n.embedding ?? null).toBeNull();
    }
  });

  it("enriches + embeds with fake providers, idempotent across re-runs (second run zeros)", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    const withProviders = {
      ...d,
      providers: { generation: createFakeGeneration(), embeddings: createFakeEmbeddings() },
    };

    const first = await runIngest(withProviders, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture"],
    });
    expect(first.enrich).toEqual({
      skipped: false,
      itemsConsidered: 2,
      itemsEnriched: 2,
      itemsFailed: 0,
    });
    expect(first.embed).toEqual({
      skipped: false,
      itemsConsidered: 2,
      itemsEmbedded: 2,
      itemsFailed: 0,
    });
    for (const n of stores.normalizedItems) {
      expect(n.llmSummary).toMatch(/^\[fake /);
      expect(n.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    }

    const second = await runIngest(withProviders, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture"],
    });
    expect(second.enrich?.itemsEnriched).toBe(0);
    expect(second.embed?.itemsEmbedded).toBe(0);
  });

  it("LLM_PROVIDER=fake in env resolves providers without explicit injection", async () => {
    const { deps: d } = deps([fakeSource]);
    d.env = { LLM_PROVIDER: "fake", EMBEDDINGS_PROVIDER: "fake" };
    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });
    expect(summary.enrich?.itemsEnriched).toBe(2);
    expect(summary.embed?.itemsEmbedded).toBe(2);
  });

  it("respects the LLM_MAX_ITEMS_PER_RUN env cap (cap-and-continue, run still succeeds)", async () => {
    const { deps: d } = deps([fakeSource]);
    d.env = { LLM_PROVIDER: "fake", EMBEDDINGS_PROVIDER: "fake", LLM_MAX_ITEMS_PER_RUN: "1" };
    const summary = await runIngest(d, { trigger: "manual", sourceSlugs: ["fake-fixture"] });
    expect(summary.status).toBe("success");
    expect(summary.enrich?.itemsEnriched).toBe(1);
    expect(summary.embed?.itemsEmbedded).toBe(1);
    // Sanity on the parser itself.
    expect(parseLlmMaxItems({})).toBe(400);
    expect(parseLlmMaxItems({ LLM_MAX_ITEMS_PER_RUN: "0" })).toBe(400);
    expect(parseLlmMaxItems({ LLM_MAX_ITEMS_PER_RUN: "junk" })).toBe(400);
  });

  it("contains an enrich-stage failure: items persist, phase 'enrich' recorded, later stages run", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    d.repos.intelligence.listEnrichableItems = async () => {
      throw new Error("boom: simulated enrich-stage bug");
    };
    const withProviders = {
      ...d,
      providers: { generation: createFakeGeneration(), embeddings: createFakeEmbeddings() },
    };

    const summary = await runIngest(withProviders, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture"],
    });
    expect(summary.status).toBe("success");
    expect(summary.itemsNew).toBe(2);
    expect(summary.enrich).toBeUndefined();
    expect(summary.embed).toBeDefined(); // embed unaffected
    expect(summary.clusters).toBeDefined();
    expect(stores.errors).toHaveLength(1);
    expect(stores.errors[0]?.phase).toBe("enrich");
    expect(stores.errors[0]?.message).toContain("[enrich/stage_failed]");
    expect(stores.runs[0]?.notes).toBe("enrich stage failed");
  });

  it("contains an embed-stage failure: phase 'embed' recorded, cluster still runs", async () => {
    const { deps: d, stores } = deps([fakeSource]);
    d.repos.intelligence.listEmbeddableItems = async () => {
      throw new Error("boom: simulated embed-stage bug");
    };
    const withProviders = {
      ...d,
      providers: { generation: createFakeGeneration(), embeddings: createFakeEmbeddings() },
    };

    const summary = await runIngest(withProviders, {
      trigger: "manual",
      sourceSlugs: ["fake-fixture"],
    });
    expect(summary.status).toBe("success");
    expect(summary.enrich?.itemsEnriched).toBe(2); // enrich unaffected
    expect(summary.embed).toBeUndefined();
    expect(summary.clusters).toBeDefined();
    expect(stores.errors).toHaveLength(1);
    expect(stores.errors[0]?.phase).toBe("embed");
    expect(stores.errors[0]?.message).toContain("[embed/stage_failed]");
    expect(stores.runs[0]?.notes).toBe("embed stage failed");
  });

});
