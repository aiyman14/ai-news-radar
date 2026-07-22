import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { huggingfaceAdapter } from "../../../src/adapters/huggingface";
import { getAdapter } from "../../../src/adapters/registry";
import type { FetchContext, Logger } from "../../../src/adapters/types";
import type { SourceConfig } from "../../../src/types/source";
import type { Json } from "../../../src/types/item";
import { FetchError } from "../../../src/errors";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function ctx(): FetchContext {
  return { now: new Date("2026-07-07T12:00:00Z"), env: {}, logger: silentLogger };
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function modelsSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: "00000000-0000-0000-0000-0000000000dd",
    slug: "hf-trending-models",
    type: "huggingface",
    name: "HF Trending Models",
    url: "https://huggingface.co/api/models?sort=trendingScore&limit=30",
    config: { endpoint: "models", sort: "trendingScore", limit: 30 },
    trustScore: 7,
    defaultKindHint: "launch",
    enabled: true,
    ...overrides,
  };
}

function spacesSource(): SourceConfig {
  return modelsSource({
    id: "00000000-0000-0000-0000-0000000000ee",
    slug: "hf-trending-spaces",
    name: "HF Trending Spaces",
    url: "https://huggingface.co/api/spaces?sort=trendingScore&limit=30",
    config: { endpoint: "spaces", sort: "trendingScore", limit: 30 },
    defaultKindHint: "tool",
  });
}

function stubFetch(respond: () => Response) {
  const spy = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => respond());
  vi.stubGlobal("fetch", spy);
  return spy;
}

function payloadOf(item: { payload: Json }): { [key: string]: Json } {
  return item.payload as { [key: string]: Json };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("huggingfaceAdapter — registry", () => {
  it("is registered for type 'huggingface'", () => {
    expect(getAdapter("huggingface")).toBe(huggingfaceAdapter);
  });
});

describe("huggingfaceAdapter — models -> common payload", () => {
  it("maps trending models with engagement {likes, downloads, trendingScore}", async () => {
    const spy = stubFetch(() => new Response(fixture("models.json"), { status: 200 }));
    const result = await huggingfaceAdapter.fetch(modelsSource(), ctx());

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    // 3 models with ids kept; the id-less entry is skipped
    expect(result.value).toHaveLength(3);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toBe(
      "https://huggingface.co/api/models?sort=trendingScore&limit=30",
    );
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["user-agent"]).toContain("ai-news-radar:ingest");
    expect(headers["accept"]).toBe("application/json");

    const [llama, flux, bare] = result.value;

    expect(llama?.externalId).toBe("meta-llama/Llama-4");
    const p1 = payloadOf(llama!);
    expect(p1.title).toBe("meta-llama/Llama-4");
    expect(p1.url).toBe("https://huggingface.co/meta-llama/Llama-4");
    expect(p1.body).toBe("text-generation"); // pipeline_tag for models
    expect(p1.author).toBe("meta-llama");
    expect(p1.published_at).toBe("2026-06-30T15:00:00.000Z");
    expect(p1.engagement).toEqual({ likes: 12500, downloads: 4800000, trendingScore: 312 });

    expect(flux?.externalId).toBe("black-forest-labs/FLUX.2-dev");
    expect(payloadOf(flux!).engagement).toEqual({
      likes: 9800,
      downloads: 2100000,
      trendingScore: 250,
    });

    // missing metrics default to 0; missing createdAt/pipeline_tag -> null
    const p3 = payloadOf(bare!);
    expect(bare?.externalId).toBe("tiny-org/no-metrics-model");
    expect(p3.engagement).toEqual({ likes: 0, downloads: 0, trendingScore: 0 });
    expect(p3.body).toBeNull();
    expect(p3.published_at).toBeNull();
  });
});

describe("huggingfaceAdapter — spaces URL construction", () => {
  it("builds https://huggingface.co/spaces/<id> and uses sdk as body", async () => {
    stubFetch(() => new Response(fixture("spaces.json"), { status: 200 }));
    const result = await huggingfaceAdapter.fetch(spacesSource(), ctx());

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value).toHaveLength(2);

    const [deepsite, loralab] = result.value;
    expect(deepsite?.externalId).toBe("enzostvs/deepsite");
    const p1 = payloadOf(deepsite!);
    expect(p1.url).toBe("https://huggingface.co/spaces/enzostvs/deepsite");
    expect(p1.body).toBe("docker"); // sdk for spaces
    expect(p1.author).toBe("enzostvs");
    // spaces have no downloads counter -> defaults to 0
    expect(p1.engagement).toEqual({ likes: 4200, downloads: 0, trendingScore: 180 });

    expect(payloadOf(loralab!).url).toBe(
      "https://huggingface.co/spaces/multimodalart/flux-2-lora-lab",
    );
  });
});

describe("huggingfaceAdapter — expected failures return err(FetchError), never throw", () => {
  it("missing url -> err(missing_url) without any network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await huggingfaceAdapter.fetch(modelsSource({ url: null }), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("missing_url");
    expect(spy).not.toHaveBeenCalled();
  });

  it("HTTP >= 400 -> err(http_status)", async () => {
    stubFetch(() => new Response("upstream sad", { status: 503, statusText: "Service Unavailable" }));
    const result = await huggingfaceAdapter.fetch(modelsSource(), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("http_status");
    expect(result.error.message).toContain("503");
  });

  it("malformed JSON -> err(parse_json)", async () => {
    stubFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
    const result = await huggingfaceAdapter.fetch(modelsSource(), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parse_json");
  });

  it("non-array JSON -> err(parse_json)", async () => {
    stubFetch(() => new Response('{"error":"unexpected"}', { status: 200 }));
    const result = await huggingfaceAdapter.fetch(modelsSource(), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parse_json");
  });

  it("timeout (AbortError) -> err(timeout)", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortError; }));
    const result = await huggingfaceAdapter.fetch(modelsSource(), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timeout");
  });
});
