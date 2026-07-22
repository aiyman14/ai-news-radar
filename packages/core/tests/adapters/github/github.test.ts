import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubReleasesAdapter } from "../../../src/adapters/github";
import { getAdapter } from "../../../src/adapters/registry";
import type { FetchContext, Logger } from "../../../src/adapters/types";
import type { SourceConfig } from "../../../src/types/source";
import type { Json } from "../../../src/types/item";
import { FetchError } from "../../../src/errors";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function ctx(env: Record<string, string | undefined> = {}, logger: Logger = silentLogger): FetchContext {
  return { now: new Date("2026-07-07T12:00:00Z"), env, logger };
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: "00000000-0000-0000-0000-0000000000cc",
    slug: "github-releases-ai",
    type: "github_releases",
    name: "AI tooling releases",
    url: "https://api.github.com",
    config: { per_page: 5, repos: ["ollama/ollama", "vllm-project/vllm"] },
    trustScore: 7,
    defaultKindHint: "launch",
    enabled: true,
    ...overrides,
  };
}

/**
 * Route stubbed fetch by repo path. Each responder returns a Response.
 * Zero real network.
 */
function stubGithub(responders: Record<string, () => Response>) {
  const spy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [repo, respond] of Object.entries(responders)) {
      if (url.includes(`/repos/${repo}/releases`)) return respond();
    }
    return new Response("not found", { status: 404, statusText: "Not Found" });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function payloadOf(item: { payload: Json }): { [key: string]: Json } {
  return item.payload as { [key: string]: Json };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("githubReleasesAdapter — registry", () => {
  it("is registered for type 'github_releases'", () => {
    expect(getAdapter("github_releases")).toBe(githubReleasesAdapter);
  });
});

describe("githubReleasesAdapter — releases -> common payload", () => {
  it("iterates repos, maps releases, skips drafts, flags prereleases", async () => {
    const spy = stubGithub({
      "ollama/ollama": () => new Response(fixture("releases-ollama.json"), { status: 200 }),
      "vllm-project/vllm": () => new Response(fixture("releases-vllm.json"), { status: 200 }),
    });
    const result = await githubReleasesAdapter.fetch(source(), ctx());

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    // 3 ollama releases (1 draft skipped) + 1 vllm release = 3 items
    expect(result.value).toHaveLength(3);

    // one request per repo, correct URL + headers, NO auth when token unset
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/ollama/ollama/releases?per_page=5",
    );
    expect(String(spy.mock.calls[1]![0])).toBe(
      "https://api.github.com/repos/vllm-project/vllm/releases?per_page=5",
    );
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["accept"]).toBe("application/vnd.github+json");
    expect(headers["user-agent"]).toContain("ai-news-radar:ingest");
    expect(headers["authorization"]).toBeUndefined();

    const [stable, rc, vllm] = result.value;

    // stable release: full mapping incl. engagement.reactions
    expect(stable?.externalId).toBe("1001");
    const p1 = payloadOf(stable!);
    expect(p1.title).toBe("ollama/ollama v0.9.0");
    expect(p1.url).toBe("https://github.com/ollama/ollama/releases/tag/v0.9.0");
    expect(p1.body).toContain("Faster model loading");
    expect(p1.author).toBe("ollama-bot");
    expect(p1.published_at).toBe("2026-07-06T18:00:00.000Z");
    expect(p1.engagement).toEqual({ reactions: 42 });
    expect(p1.prerelease).toBe(false);
    expect(p1.repo).toBe("ollama/ollama");

    // draft 1002 skipped entirely
    expect(result.value.map((i) => i.externalId)).not.toContain("1002");

    // prerelease kept + flagged; null name falls back to tag_name; no reactions -> null
    expect(rc?.externalId).toBe("1003");
    const p2 = payloadOf(rc!);
    expect(p2.title).toBe("ollama/ollama v0.9.1-rc1");
    expect(p2.prerelease).toBe(true);
    expect(p2.engagement).toBeNull();

    // second repo: empty name falls back to tag_name
    expect(vllm?.externalId).toBe("2001");
    expect(payloadOf(vllm!).title).toBe("vllm-project/vllm v0.6.0");
  });

  it("sends Authorization: Bearer only when ctx.env.GITHUB_TOKEN is set", async () => {
    const spy = stubGithub({
      "ollama/ollama": () => new Response(fixture("releases-ollama.json"), { status: 200 }),
      "vllm-project/vllm": () => new Response(fixture("releases-vllm.json"), { status: 200 }),
    });
    const result = await githubReleasesAdapter.fetch(source(), ctx({ GITHUB_TOKEN: "ghp_test123" }));
    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    for (const call of spy.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer ghp_test123");
    }
  });

  it("respects config.per_page and defaults to 5", async () => {
    const spy = stubGithub({
      "ollama/ollama": () => new Response(fixture("releases-ollama.json"), { status: 200 }),
    });
    await githubReleasesAdapter.fetch(
      source({ config: { per_page: 3, repos: ["ollama/ollama"] } }),
      ctx(),
    );
    expect(String(spy.mock.calls[0]![0])).toContain("per_page=3");

    spy.mockClear();
    await githubReleasesAdapter.fetch(source({ config: { repos: ["ollama/ollama"] } }), ctx());
    expect(String(spy.mock.calls[0]![0])).toContain("per_page=5");
  });
});

describe("githubReleasesAdapter — partial repo failure keeps successes", () => {
  it("returns ok(items) when one repo 500s and warns about it", async () => {
    const warn = vi.fn();
    stubGithub({
      "ollama/ollama": () => new Response("boom", { status: 500, statusText: "Internal Server Error" }),
      "vllm-project/vllm": () => new Response(fixture("releases-vllm.json"), { status: 200 }),
    });
    const result = await githubReleasesAdapter.fetch(
      source(),
      ctx({}, { info: () => {}, warn, error: () => {} }),
    );
    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value.map((i) => i.externalId)).toEqual(["2001"]);
    expect(warn).toHaveBeenCalledWith(
      "github repo fetch failed",
      expect.objectContaining({ repo: "ollama/ollama", code: "http_status" }),
    );
  });

  it("errs with failed repos in detail only when ALL repos fail", async () => {
    stubGithub({
      "ollama/ollama": () => new Response("nope", { status: 404, statusText: "Not Found" }),
      "vllm-project/vllm": () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }),
    });
    const result = await githubReleasesAdapter.fetch(source(), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("all_repos_failed");
    const detail = result.error.detail as { failures: { repo: string }[] };
    expect(detail.failures.map((f) => f.repo)).toEqual(["ollama/ollama", "vllm-project/vllm"]);
  });
});

describe("githubReleasesAdapter — expected failures return err(FetchError), never throw", () => {
  it("missing config.repos -> err(missing_config) without any network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await githubReleasesAdapter.fetch(source({ config: {} }), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_config");
    expect(spy).not.toHaveBeenCalled();
  });

  it("HTTP >= 400 on the only repo -> err(http_status)", async () => {
    stubGithub({
      "ollama/ollama": () => new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    });
    const result = await githubReleasesAdapter.fetch(
      source({ config: { repos: ["ollama/ollama"] } }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("http_status");
    expect(result.error.message).toContain("403");
  });

  it("malformed JSON -> err(parse_json)", async () => {
    stubGithub({
      "ollama/ollama": () => new Response("<html>rate limited</html>", { status: 200 }),
    });
    const result = await githubReleasesAdapter.fetch(
      source({ config: { repos: ["ollama/ollama"] } }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parse_json");
  });

  it("non-array JSON body -> err(parse_json)", async () => {
    stubGithub({
      "ollama/ollama": () => new Response('{"message":"API rate limit exceeded"}', { status: 200 }),
    });
    const result = await githubReleasesAdapter.fetch(
      source({ config: { repos: ["ollama/ollama"] } }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parse_json");
  });

  it("timeout (AbortError) -> err(timeout)", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortError; }));
    const result = await githubReleasesAdapter.fetch(
      source({ config: { repos: ["ollama/ollama"] } }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timeout");
  });
});
