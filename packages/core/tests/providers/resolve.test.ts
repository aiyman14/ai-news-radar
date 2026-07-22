import { describe, expect, it } from "vitest";
import { resolveProviders } from "../../src/providers/index";

describe("resolveProviders — selection & graceful-skip logic", () => {
  it("nothing configured → both null, one notice per slot", () => {
    const r = resolveProviders({});
    expect(r.generation).toBeNull();
    expect(r.embeddings).toBeNull();
    expect(r.notices).toHaveLength(2);
    expect(r.notices[0]).toContain("LLM_PROVIDER unset");
    expect(r.notices[1]).toContain("EMBEDDINGS_PROVIDER unset");
  });

  it("provider selected but key missing → null with a notice naming the var (never the value)", () => {
    const r = resolveProviders({ LLM_PROVIDER: "anthropic", EMBEDDINGS_PROVIDER: "voyage" });
    expect(r.generation).toBeNull();
    expect(r.embeddings).toBeNull();
    expect(r.notices.some((n) => n.includes("ANTHROPIC_API_KEY unset"))).toBe(true);
    expect(r.notices.some((n) => n.includes("VOYAGE_API_KEY unset"))).toBe(true);
  });

  it("anthropic + voyage with keys → providers resolved, no notices, keys never in notices", () => {
    const r = resolveProviders({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      EMBEDDINGS_PROVIDER: "voyage",
      VOYAGE_API_KEY: "pa-secret",
    });
    expect(r.generation?.name).toBe("anthropic");
    expect(r.embeddings?.name).toBe("voyage");
    expect(r.notices).toHaveLength(0);
    expect(JSON.stringify(r.notices)).not.toContain("secret");
  });

  it("openai serves both interfaces off one key", () => {
    const r = resolveProviders({
      LLM_PROVIDER: "openai",
      EMBEDDINGS_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-secret",
    });
    expect(r.generation?.name).toBe("openai");
    expect(r.embeddings?.name).toBe("openai");
    expect(r.notices).toHaveLength(0);
  });

  it("fake needs no key on either slot", () => {
    const r = resolveProviders({ LLM_PROVIDER: "fake", EMBEDDINGS_PROVIDER: "fake" });
    expect(r.generation?.name).toBe("fake");
    expect(r.embeddings?.name).toBe("fake");
    expect(r.notices).toHaveLength(0);
  });

  it("unknown provider values → null with an explanatory notice", () => {
    const r = resolveProviders({ LLM_PROVIDER: "gemini", EMBEDDINGS_PROVIDER: "cohere" });
    expect(r.generation).toBeNull();
    expect(r.embeddings).toBeNull();
    expect(r.notices.some((n) => n.includes("'gemini'"))).toBe(true);
    expect(r.notices.some((n) => n.includes("'cohere'"))).toBe(true);
  });

  it("empty-string env values behave like unset", () => {
    const r = resolveProviders({ LLM_PROVIDER: "", EMBEDDINGS_PROVIDER: "  " });
    expect(r.generation).toBeNull();
    expect(r.embeddings).toBeNull();
  });

  it("mixed: generation configured, embeddings not → independent slots", () => {
    const r = resolveProviders({ LLM_PROVIDER: "fake" });
    expect(r.generation?.name).toBe("fake");
    expect(r.embeddings).toBeNull();
    expect(r.notices).toHaveLength(1);
  });
});
