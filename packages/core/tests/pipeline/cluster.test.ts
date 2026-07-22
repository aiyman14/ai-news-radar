import { describe, expect, it } from "vitest";
import {
  CLUSTER_SUMMARY_MAX_CHARS,
  computeClusterPatch,
  cosineSimilarity,
  mapCosineToSimilarity,
  SEMANTIC_COSINE_FLOOR,
  groupWindowItems,
  runClusterStage,
  summarizeBody,
  titleSimilarity,
} from "../../src/pipeline/cluster";
import { createInMemoryRepositories, type MemoryStores } from "../../src/db/repositories/memory";
import type { ClusterableItem, NormalizedDraft } from "../../src/types/item";
import type { Logger } from "../../src/adapters/types";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Fixed clock — determinism per the stage contract. */
const NOW = new Date("2026-07-07T12:00:00Z");
const now = () => NOW;

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function makeItem(id: string, title: string, over: Partial<ClusterableItem> = {}): ClusterableItem {
  return {
    id,
    title,
    publishedAt: hoursAgo(2),
    fetchedAt: hoursAgo(1),
    score: 10,
    tags: [],
    entities: [],
    bodyText: null,
    clusterId: null,
    ...over,
  };
}

// Titles built around real corpus shapes: same launch, different phrasing.
const T_LAUNCH_A = "Qwen3 235B released with day one llama.cpp support";
const T_LAUNCH_B = "Qwen3 235B released with day one vllm support";
const T_UNRELATED = "Ask HN what laptop do you use for local inference";

describe("groupWindowItems", () => {
  it("groups near-duplicate titles and leaves unrelated items apart", () => {
    const items = [
      makeItem("a", T_LAUNCH_A),
      makeItem("b", T_LAUNCH_B),
      makeItem("c", T_UNRELATED),
    ];
    const groups = groupWindowItems(items, { threshold: 0.4 });
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("clusters at exactly the threshold, not below it", () => {
    // 4-word titles, k=3: shingles {w1w2w3, w2w3w4}; one shared => J = 1/3.
    const a = makeItem("a", "alpha beta gamma delta");
    const b = makeItem("b", "alpha beta gamma epsilon");
    expect(titleSimilarity(a.title, b.title)).toBeCloseTo(1 / 3);
    expect(groupWindowItems([a, b], { threshold: 1 / 3 })).toHaveLength(1);
    expect(groupWindowItems([a, b], { threshold: 0.34 })).toHaveLength(2);
  });

  it("chains transitively (single-link): A~B and B~C pull A and C together", () => {
    const a = makeItem("a", "one two three four");
    const b = makeItem("b", "one two three four five");
    const c = makeItem("c", "two three four five six");
    // a~c is below the threshold that a~b and b~c clear
    const groups = groupWindowItems([a, b, c], { threshold: 0.4 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps items sharing an existing cluster_id together even when dissimilar", () => {
    const a = makeItem("a", "completely different words here", { clusterId: "cl-1" });
    const b = makeItem("b", "nothing in common at all", { clusterId: "cl-1" });
    const groups = groupWindowItems([a, b], { threshold: 0.5 });
    expect(groups).toHaveLength(1);
  });

  it("never merges titles that normalize to zero shingles", () => {
    const a = makeItem("a", "!!!");
    const b = makeItem("b", "???");
    expect(groupWindowItems([a, b])).toHaveLength(2);
  });
});

describe("computeClusterPatch", () => {
  it("picks the highest-scored member as representative and unions metadata", () => {
    const low = makeItem("a", "Qwen3 released", {
      score: 5,
      tags: ["llm"],
      entities: ["Alibaba"],
      publishedAt: hoursAgo(10),
    });
    const high = makeItem("b", "Qwen3 235B released with benchmarks", {
      score: 20,
      tags: ["benchmark", "llm"],
      entities: ["Qwen"],
      bodyText: "Full benchmark suite results.",
      publishedAt: hoursAgo(4),
    });
    const patch = computeClusterPatch([low, high]);
    expect(patch.representativeId).toBe("b");
    expect(patch.title).toBe(high.title);
    expect(patch.summary).toBe("Full benchmark suite results.");
    expect(patch.tags).toEqual(["benchmark", "llm"]); // sorted union
    expect(patch.entities).toEqual(["Alibaba", "Qwen"]);
    expect(patch.itemCount).toBe(2);
    expect(patch.score).toBe(20);
    expect(patch.firstSeenAt).toEqual(hoursAgo(10));
    expect(patch.lastSeenAt).toEqual(hoursAgo(4));
  });

  it("breaks score ties by earlier published_at, then smaller id", () => {
    const later = makeItem("a", "t", { score: 7, publishedAt: hoursAgo(1) });
    const earlier = makeItem("b", "t", { score: 7, publishedAt: hoursAgo(9) });
    expect(computeClusterPatch([later, earlier]).representativeId).toBe("b");

    const twinA = makeItem("a", "t", { score: 7, publishedAt: hoursAgo(3) });
    const twinB = makeItem("b", "t", { score: 7, publishedAt: hoursAgo(3) });
    expect(computeClusterPatch([twinB, twinA]).representativeId).toBe("a");
  });

  it("falls back to fetched_at for items without published_at", () => {
    const undated = makeItem("a", "t", { publishedAt: null, fetchedAt: hoursAgo(50) });
    const dated = makeItem("b", "t", { publishedAt: hoursAgo(5) });
    const patch = computeClusterPatch([undated, dated]);
    expect(patch.firstSeenAt).toEqual(hoursAgo(50));
    expect(patch.lastSeenAt).toEqual(hoursAgo(5));
  });
});

describe("summarizeBody", () => {
  it("passes short bodies through with whitespace collapsed", () => {
    expect(summarizeBody("  hello\n\n world ")).toBe("hello world");
  });
  it("returns null for null or blank bodies", () => {
    expect(summarizeBody(null)).toBeNull();
    expect(summarizeBody("   \n ")).toBeNull();
  });
  it("trims long bodies at a word boundary with an ellipsis", () => {
    const body = Array(100).fill("word").join(" ");
    const summary = summarizeBody(body)!;
    expect(summary.length).toBeLessThanOrEqual(CLUSTER_SUMMARY_MAX_CHARS + 1);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("wor…"); // never cuts mid-word
  });
});

// ---------------------------------------------------------------------------
// Stage behavior against the in-memory repos
// ---------------------------------------------------------------------------

function makeDraft(title: string, over: Partial<NormalizedDraft> = {}): NormalizedDraft {
  return {
    externalId: `ext-${title.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`,
    canonicalUrl: null,
    title,
    bodyText: null,
    bodyHtml: null,
    imageUrl: null,
    media: {},
    authorName: null,
    publishedAt: hoursAgo(2),
    language: "en",
    tags: [],
    entities: [],
    engagement: null,
    contentHash: "0".repeat(64),
    kind: "news",
    kindConfidence: 0.5,
    score: 10,
    ...over,
  };
}

function seedItem(
  stores: MemoryStores,
  id: string,
  title: string,
  over: Partial<NormalizedDraft> = {},
  opts: { fetchedAt?: Date; clusterId?: string | null } = {},
) {
  stores.normalizedItems.push({
    id,
    rawItemId: `raw-${id}`,
    sourceId: "src-1",
    draft: makeDraft(title, over),
    fetchedAt: (opts.fetchedAt ?? hoursAgo(1)).toISOString(),
    clusterId: opts.clusterId ?? null,
  });
}

function stage() {
  return createInMemoryRepositories([]);
}

describe("runClusterStage (in-memory repos)", () => {
  it("creates a cluster for near-dupes, assigns members, leaves singletons null", async () => {
    const { repos, stores } = stage();
    seedItem(stores, "i1", T_LAUNCH_A, { score: 5 });
    seedItem(stores, "i2", T_LAUNCH_B, { score: 15, bodyText: "The vllm build ships today." });
    seedItem(stores, "i3", T_UNRELATED);

    const result = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });

    expect(result).toEqual({
      itemsConsidered: 3,
      itemsAssigned: 2,
      clustersCreated: 1,
      clustersUpdated: 0,
      clustersMerged: 0,
    });
    expect(stores.clusters).toHaveLength(1);
    const cluster = stores.clusters[0]!;
    expect(cluster.itemCount).toBe(2);
    expect(cluster.representativeId).toBe("i2"); // highest score
    expect(cluster.title).toBe(T_LAUNCH_B);
    expect(cluster.summary).toBe("The vllm build ships today.");
    expect(cluster.score).toBe(15);

    const byId = new Map(stores.normalizedItems.map((n) => [n.id, n.clusterId]));
    expect(byId.get("i1")).toBe(cluster.id);
    expect(byId.get("i2")).toBe(cluster.id);
    expect(byId.get("i3")).toBeNull(); // singleton stays unclustered
  });

  it("is idempotent: a second run writes nothing and counts stay stable", async () => {
    const { repos, stores } = stage();
    seedItem(stores, "i1", T_LAUNCH_A);
    seedItem(stores, "i2", T_LAUNCH_B);

    const first = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });
    const clusterId = stores.clusters[0]!.id;
    const second = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });

    expect(first.clustersCreated).toBe(1);
    expect(second).toEqual({
      itemsConsidered: 2,
      itemsAssigned: 0,
      clustersCreated: 0,
      clustersUpdated: 0,
      clustersMerged: 0,
    });
    expect(stores.clusters).toHaveLength(1);
    expect(stores.clusters[0]!.id).toBe(clusterId); // same row, not a duplicate
  });

  it("ignores items outside the window even when their titles match", async () => {
    const { repos, stores } = stage();
    seedItem(stores, "old", T_LAUNCH_A, {}, { fetchedAt: hoursAgo(100) }); // > 72h
    seedItem(stores, "new", T_LAUNCH_B);

    const result = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });

    expect(result.itemsConsidered).toBe(1);
    expect(result.clustersCreated).toBe(0);
    expect(stores.normalizedItems.find((n) => n.id === "old")!.clusterId).toBeNull();
    expect(stores.normalizedItems.find((n) => n.id === "new")!.clusterId).toBeNull();
  });

  it("adds a late arrival to an existing cluster and refreshes upkeep from full membership", async () => {
    const { repos, stores } = stage();
    seedItem(stores, "i1", T_LAUNCH_A, { score: 5 });
    seedItem(stores, "i2", T_LAUNCH_B, { score: 15 });
    await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });
    const clusterId = stores.clusters[0]!.id;

    // i1 falls out of the window; a third phrasing arrives.
    stores.normalizedItems.find((n) => n.id === "i1")!.fetchedAt = hoursAgo(100).toISOString();
    seedItem(stores, "i3", "Qwen3 235B released with day one mlx support", {
      score: 30,
      publishedAt: hoursAgo(0.5),
    });

    const result = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });

    expect(result.clustersCreated).toBe(0);
    expect(result.clustersUpdated).toBe(1);
    expect(result.itemsAssigned).toBe(1);
    expect(stores.clusters).toHaveLength(1);
    const cluster = stores.clusters[0]!;
    expect(cluster.id).toBe(clusterId);
    expect(cluster.itemCount).toBe(3); // out-of-window member still counted
    expect(cluster.representativeId).toBe("i3");
    expect(cluster.score).toBe(30);
    expect(stores.normalizedItems.find((n) => n.id === "i3")!.clusterId).toBe(clusterId);
    // The out-of-window member keeps its assignment.
    expect(stores.normalizedItems.find((n) => n.id === "i1")!.clusterId).toBe(clusterId);
  });

  it("merges two clusters bridged by a new item: smallest id survives, loser is deleted", async () => {
    const { repos, stores } = stage();
    // Two pre-existing clusters (as a previous run would have left them).
    const idA = await repos.clusters.createCluster(
      computeClusterPatch([makeItem("a1", "one two three four")]),
    );
    const idB = await repos.clusters.createCluster(
      computeClusterPatch([makeItem("b1", "three four five six")]),
    );
    seedItem(stores, "a1", "one two three four", {}, { clusterId: idA });
    seedItem(stores, "a2", "one two three four again", {}, { clusterId: idA });
    seedItem(stores, "b1", "three four five six", {}, { clusterId: idB });
    seedItem(stores, "b2", "three four five six again", {}, { clusterId: idB });
    // The bridge overlaps both phrasings.
    seedItem(stores, "bridge", "two three four five");

    const result = await runClusterStage(
      { clusters: repos.clusters, logger: silentLogger, now },
      { threshold: 0.3 },
    );

    expect(result.clustersMerged).toBe(1);
    expect(result.clustersUpdated).toBe(1);
    expect(stores.clusters).toHaveLength(1);
    const survivor = stores.clusters[0]!;
    expect(survivor.id).toBe([idA, idB].sort()[0]); // smallest id wins
    expect(survivor.itemCount).toBe(5);
    for (const id of ["a1", "a2", "b1", "b2", "bridge"]) {
      expect(stores.normalizedItems.find((n) => n.id === id)!.clusterId).toBe(survivor.id);
    }
  });

  it("does not unassign a lone in-window member whose partners left the window", async () => {
    const { repos, stores } = stage();
    seedItem(stores, "i1", T_LAUNCH_A);
    seedItem(stores, "i2", T_LAUNCH_B);
    await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });
    const clusterId = stores.clusters[0]!.id;

    stores.normalizedItems.find((n) => n.id === "i1")!.fetchedAt = hoursAgo(100).toISOString();
    const result = await runClusterStage({ clusters: repos.clusters, logger: silentLogger, now });

    expect(result.itemsAssigned).toBe(0);
    expect(result.clustersUpdated).toBe(0); // converged — nothing written
    expect(stores.normalizedItems.find((n) => n.id === "i2")!.clusterId).toBe(clusterId);
    expect(stores.clusters).toHaveLength(1);
  });
});

describe("semantic assist (CLUSTER_SEMANTIC — default OFF)", () => {
  // Two items about the same story, worded too differently for shingles,
  // carrying near-identical embeddings.
  const vecA = [1, 0, 0.05];
  const vecB = [0.99, 0.01, 0.05];
  const semantic = [
    makeItem("s1", "Qwen3 235B lands with day-one runtime support", { embedding: vecA }),
    makeItem("s2", "Alibaba's newest open flagship model is here", { embedding: vecB }),
  ];

  it("off (default): dissimilar titles stay apart even with matching embeddings", () => {
    const groups = groupWindowItems(semantic);
    expect(groups).toHaveLength(2);
  });

  it("on: near-identical embeddings join what titles cannot", () => {
    const groups = groupWindowItems(semantic, { semantic: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  it("on: items without embeddings still cluster by title only", () => {
    const groups = groupWindowItems(
      [makeItem("t1", T_LAUNCH_A), makeItem("t2", T_LAUNCH_B), makeItem("t3", T_UNRELATED)],
      { semantic: true },
    );
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([["t1", "t2"], ["t3"]]);
  });

  it("on: orthogonal embeddings never merge (mapped cosine below any threshold)", () => {
    const groups = groupWindowItems(
      [
        makeItem("o1", "Completely different first title", { embedding: [1, 0, 0] }),
        makeItem("o2", "Another unrelated second story", { embedding: [0, 1, 0] }),
      ],
      { semantic: true },
    );
    expect(groups).toHaveLength(2);
  });

  it("mapCosineToSimilarity maps the floor to 0 and 1.0 to 1.0, clamped below", () => {
    expect(mapCosineToSimilarity(SEMANTIC_COSINE_FLOOR)).toBe(0);
    expect(mapCosineToSimilarity(1)).toBe(1);
    expect(mapCosineToSimilarity(0)).toBe(0); // clamped, not negative
  });

  it("cosineSimilarity basics: parallel=1, orthogonal=0, zero vector=0", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 8);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
