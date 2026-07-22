import { describe, expect, it } from "vitest";
import { classifyKind } from "../../src/pipeline/classify";

describe("classifyKind", () => {
  it("matches keyword rules (launch)", () => {
    const r = classifyKind(
      { title: "Mistral releases Codestral v2.0", bodyText: null },
      { defaultKindHint: null },
    );
    expect(r.kind).toBe("launch");
    expect(r.confidence).toBe(0.7);
  });

  it("boosts confidence when the rule agrees with the source prior", () => {
    const r = classifyKind(
      { title: "How to build agents: a practical guide", bodyText: null },
      { defaultKindHint: "tip" },
    );
    expect(r.kind).toBe("tip");
    expect(r.confidence).toBe(0.9);
  });

  it("falls back to the source prior when no rule fires", () => {
    const r = classifyKind(
      { title: "Weekly roundup of miscellany", bodyText: null },
      { defaultKindHint: "discussion" },
    );
    expect(r.kind).toBe("discussion");
    expect(r.confidence).toBe(0.4);
  });

  it("defaults to news at low confidence with no signal", () => {
    const r = classifyKind({ title: "Miscellany weekly", bodyText: null }, { defaultKindHint: null });
    expect(r.kind).toBe("news");
    expect(r.confidence).toBe(0.2);
  });

  it("classifies research via paper/arxiv patterns", () => {
    const r = classifyKind(
      { title: "New arXiv paper: scaling laws revisited", bodyText: null },
      { defaultKindHint: "news" },
    );
    expect(r.kind).toBe("research");
  });
});
