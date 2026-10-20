import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rssAdapter } from "../../../src/adapters/rss";
import { getAdapter } from "../../../src/adapters/registry";
import type { FetchContext, Logger } from "../../../src/adapters/types";
import type { SourceConfig } from "../../../src/types/source";
import type { Json } from "../../../src/types/item";
import { FetchError } from "../../../src/errors";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const ctx: FetchContext = {
  now: new Date("2026-07-06T12:00:00Z"),
  env: {},
  logger: silentLogger,
};

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
    slug: "rss-fixture",
    type: "rss",
    name: "Fixture feed",
    url: "https://feeds.example.com/feed.xml",
    config: {},
    trustScore: 5,
    defaultKindHint: "news",
    enabled: true,
    ...overrides,
  };
}

/** Stub globalThis.fetch to return the given body (or throw). */
function stubFetch(body: string, init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(async () => new Response(body, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function payloadOf(item: { payload: Json }): { [key: string]: Json } {
  return item.payload as { [key: string]: Json };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rssAdapter — registry", () => {
  it("is registered for type 'rss'", () => {
    expect(getAdapter("rss")).toBe(rssAdapter);
  });
});

describe("rssAdapter — RSS 2.0", () => {
  it("parses items into the common payload shape", async () => {
    stubFetch(fixture("rss2.xml"));
    const result = await rssAdapter.fetch(source(), ctx);

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value).toHaveLength(3);

    const [first, second, third] = result.value;

    // guid wins as externalId
    expect(first?.externalId).toBe("news-gpt-6-001");
    const p1 = payloadOf(first!);
    expect(p1.title).toBe("OpenAI ships GPT-6 with sharper reasoning & lower prices");
    expect(p1.url).toBe("https://example.com/news/gpt-6");
    expect(p1.body).toContain("OpenAI today released GPT-6");
    expect(p1.body).not.toContain("<p>"); // HTML description stripped to text
    expect(p1.body_html).toContain("<article>"); // content:encoded preserved
    expect(p1.author).toBe("Fixture Reporter"); // dc:creator
    expect(p1.published_at).toBe("2026-07-06T09:30:00.000Z"); // RFC822 -> ISO
    expect(p1.image_url).toBe("https://example.com/img/gpt-6-hero.jpg"); // enclosure

    // permalink guid + media:content image + plain-text description
    expect(second?.externalId).toBe("https://example.com/news/roundup-27");
    const p2 = payloadOf(second!);
    expect(p2.body).toBe("Plain-text summary of the week in local LLM inference.");
    expect(p2.body_html).toBeNull();
    expect(p2.image_url).toBe("https://example.com/img/roundup-27.png");
    expect(p2.author).toBe("editor@example.com (Roundup Editor)");

    // audio enclosure is not an image; bad pubDate -> null
    const p3 = payloadOf(third!);
    expect(p3.image_url).toBeNull();
    expect(p3.published_at).toBeNull();
  });
});

describe("rssAdapter — Atom", () => {
  it("parses entries: id, alternate link, html content, thumbnail, ISO dates", async () => {
    stubFetch(fixture("atom.xml"));
    const result = await rssAdapter.fetch(source(), ctx);

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value).toHaveLength(2);

    const [first, second] = result.value;

    expect(first?.externalId).toBe("tag:example.org,2026:entry-001");
    const p1 = payloadOf(first!);
    expect(p1.title).toBe("Anthropic introduces Claude agents for the enterprise");
    expect(p1.url).toBe("https://example.org/posts/claude-agents"); // rel=alternate, not rel=self
    expect(p1.body).toBe("Claude gets first-class agentic tooling."); // summary
    expect(p1.body_html).toContain("<em>introduced</em>"); // entity-decoded html content
    expect(p1.author).toBe("Atom Author");
    expect(p1.published_at).toBe("2026-07-06T08:15:00.000Z"); // published wins over updated
    expect(p1.image_url).toBe("https://example.org/img/claude-agents-thumb.png"); // media:thumbnail

    expect(second?.externalId).toBe("tag:example.org,2026:entry-002");
    const p2 = payloadOf(second!);
    expect(p2.url).toBe("https://example.org/posts/minimal"); // link without rel
    expect(p2.body).toBe("Plain text content, no summary, no image.");
    expect(p2.published_at).toBe("2026-07-05T22:45:00.000Z"); // falls back to updated
    expect(p2.image_url).toBeNull();
  });
});

describe("rssAdapter — externalId fallback chain", () => {
  it("uses canonical URL when guid is missing, content hash when both are missing", async () => {
    stubFetch(fixture("missing-guid.xml"));
    const result = await rssAdapter.fetch(source(), ctx);

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value).toHaveLength(2);

    const [withLink, bare] = result.value;
    expect(withLink?.externalId).toBe("https://example.net/posts/no-guid");
    expect(bare?.externalId).toMatch(/^[0-9a-f]{64}$/); // sha256 content hash
    expect(bare?.externalId.length).toBeGreaterThan(0); // never empty
  });
});

describe("rssAdapter — keyword_filter (Product Hunt case)", () => {
  it("keeps only AI-matching entries when config.keyword_filter is set", async () => {
    stubFetch(fixture("keyword-filter.xml"));
    const result = await rssAdapter.fetch(
      source({ slug: "producthunt-ai", config: { keyword_filter: "ai" } }),
      ctx,
    );

    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    // post-1 matches on title ("AI", "copilot"); post-3 on body ("machine learning");
    // post-2 (SockMatcher) is dropped.
    const ids = result.value.map((i) => i.externalId);
    expect(ids).toEqual([
      "tag:producthunt.example,2026:post-1",
      "tag:producthunt.example,2026:post-3",
    ]);
  });

  it("keeps everything when keyword_filter is not set", async () => {
    stubFetch(fixture("keyword-filter.xml"));
    const result = await rssAdapter.fetch(source(), ctx);
    if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
    expect(result.value).toHaveLength(3);
  });
});

describe("rssAdapter — expected failures return err(FetchError), never throw", () => {
  it("malformed XML -> err(parse_xml)", async () => {
    stubFetch("<rss><channel><item><title>broken</item></rss>");
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("parse_xml");
    expect(result.error.phase).toBe("fetch");
  });

  it("non-feed XML -> err(parse_xml)", async () => {
    stubFetch(`<?xml version="1.0"?><html><body>not a feed</body></html>`);
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parse_xml");
  });

  it("HTTP >= 400 -> err(http_status)", async () => {
    stubFetch("gone", { status: 404, statusText: "Not Found" });
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(FetchError);
    expect(result.error.code).toBe("http_status");
    expect(result.error.message).toContain("404");
  });

  it("429 retries once honoring Retry-After, then succeeds", async () => {
    const responses = [
      new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      new Response(fixture("rss2.xml"), { status: 200 }),
    ];
    const spy = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", spy);
    const result = await rssAdapter.fetch(source(), ctx);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
  });

  it("429 twice -> err(http_status), no infinite retry", async () => {
    stubFetch("slow down", { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" } });
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("http_status");
    expect(result.error.message).toContain("429");
  });

  it("timeout (AbortError) -> err(timeout)", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortError; }));
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timeout");
  });

  it("network failure -> err(network)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const result = await rssAdapter.fetch(source(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("network");
  });

  it("missing source.url -> err(missing_url) without calling fetch", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await rssAdapter.fetch(source({ url: null }), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_url");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("rssAdapter — max_items cap", () => {
  it("keeps only the first max_items entries", async () => {
    stubFetch(fixture("rss2.xml")); // 3 items
    const result = await rssAdapter.fetch(source({ config: { max_items: 2 } }), ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.externalId).toBe("news-gpt-6-001");
  });
});

describe("rssAdapter — blocked host short-circuit", () => {
  it("after a 403 from a paced host, later feeds on that host fail fast without another request", async () => {
    const { resetHostStateForTests } = await import("../../../src/adapters/rss");
    resetHostStateForTests();
    const spy = stubFetch("<html>Blocked</html>", { status: 403, statusText: "Blocked" });

    const first = await rssAdapter.fetch(
      source({ slug: "reddit-a", url: "https://www.reddit.com/r/A/top/.rss" }),
      ctx,
    );
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("unreachable");
    expect(first.error).toBeInstanceOf(FetchError);
    expect(first.error.message).toContain("403");

    const second = await rssAdapter.fetch(
      source({ slug: "reddit-b", url: "https://www.reddit.com/r/B/top/.rss" }),
      ctx,
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.message).toContain("skipped");
    // Only the first feed hit the network; the second never waited out pacing.
    expect(spy).toHaveBeenCalledTimes(1);

    // Unpaced hosts are never marked blocked.
    const other = await rssAdapter.fetch(source({ url: "https://feeds.example.com/x.xml" }), ctx);
    expect(other.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    resetHostStateForTests();
  });
});
