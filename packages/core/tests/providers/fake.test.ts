import { describe, expect, it } from "vitest";
import {
  createFakeEmbeddings,
  createFakeGeneration,
  fakeEmbedding,
} from "../../src/providers/fake";
import { EMBEDDING_DIMENSIONS } from "../../src/providers/llm";

const unwrap = <T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${String(r.error)}`);
  return r.value;
};

describe("fake generation provider — deterministic, tier-shaped JSON", () => {
  const provider = createFakeGeneration();

  it("same request → byte-identical response; different prompt → different", async () => {
    const req = { system: "sys", prompt: "hello", tier: "bulk" as const };
    const a = unwrap(await provider.generate(req));
    const b = unwrap(await provider.generate(req));
    const c = unwrap(await provider.generate({ ...req, prompt: "other" }));
    expect(a.text).toBe(b.text);
    expect(a.text).not.toBe(c.text);
  });

  it("bulk tier → enrichment JSON with a summary and NO kind/tags/entities", async () => {
    const res = unwrap(await provider.generate({ system: "s", prompt: "p", tier: "bulk" }));
    const parsed = JSON.parse(res.text) as Record<string, unknown>;
    expect(typeof parsed.summary).toBe("string");
    expect((parsed.summary as string).length).toBeGreaterThan(10);
    // The fake must never overwrite deterministic classifier output.
    expect(parsed.kind).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
    expect(parsed.entities).toBeUndefined();
    expect(res.model).toBe("fake-bulk");
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it("draft tier → long-form analysis JSON (headline, key points, analysis, notes)", async () => {
    const res = unwrap(await provider.generate({ system: "s", prompt: "p", tier: "draft" }));
    const parsed = JSON.parse(res.text) as {
      headline: string;
      key_points: string[];
      analysis: string;
      notes: string[];
    };
    expect(typeof parsed.headline).toBe("string");
    expect(parsed.key_points.length).toBeGreaterThanOrEqual(3);
    expect(typeof parsed.analysis).toBe("string");
    expect(parsed.notes.length).toBeGreaterThan(0);
    expect(res.model).toBe("fake-draft");
  });
});

describe("fake embeddings provider — deterministic 1024-dim unit vectors", () => {
  const provider = createFakeEmbeddings();

  it("emits one vector per text, 1024 dims, in order", async () => {
    const vectors = unwrap(await provider.embed(["alpha", "beta", "gamma"]));
    expect(vectors).toHaveLength(3);
    for (const v of vectors) expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic per text and distinct across texts", async () => {
    const [a1] = unwrap(await provider.embed(["same text"]));
    const [a2, b] = unwrap(await provider.embed(["same text", "different text"]));
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  it("vectors are L2-normalized (unit length)", () => {
    const v = fakeEmbedding("normalize me");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("empty input → empty output", async () => {
    expect(unwrap(await provider.embed([]))).toEqual([]);
  });
});
