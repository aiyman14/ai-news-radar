import type { SourceAdapter } from "../types";
import type { Json } from "../../types/item";
import { ok } from "../../types/result";

/**
 * Fake adapter — the scaffold's end-to-end proof. Returns two deterministic
 * fixture items shaped like the "common payload" convention that
 * pipeline/normalize.ts understands (title/url/body/image_url/...).
 * Runs only for the disabled `fake-fixture` seed source when explicitly
 * named (--source fake-fixture / INGEST_LIMIT_SOURCES=fake-fixture).
 */

const FIXTURES: Array<{ externalId: string; payload: Json }> = [
  {
    externalId: "fake-001",
    payload: {
      title: "Anthropic releases Claude 5 with breakthrough agent capabilities",
      url: "https://example.com/news/claude-5-release",
      body: "Anthropic today announced Claude 5, a new frontier model with improved reasoning and agentic tool use. The release includes an updated API and lower prices.",
      body_html: null,
      image_url: "https://example.com/img/claude-5-hero.png",
      author: "Fixture Newsroom",
      published_at: "2026-07-05T14:30:00Z",
      engagement: { score: 128, comments: 42 },
    },
  },
  {
    externalId: "fake-002",
    payload: {
      title: "How to cut your LLM bill in half: a prompt caching guide",
      url: "https://example.com/tips/prompt-caching-guide",
      body: "A practical tutorial on prompt caching: structure your system prompt for reuse, batch requests, and measure hit rates. Works with Claude and GPT APIs.",
      body_html: null,
      image_url: null,
      author: "Fixture Author",
      published_at: "2026-07-06T09:00:00Z",
      engagement: { score: 87, comments: 13 },
    },
  },
];

export const fakeAdapter: SourceAdapter = {
  type: "fake",
  fetch: async (_source, ctx) => {
    ctx.logger.info("fake adapter returning fixture items", { count: FIXTURES.length });
    return ok(FIXTURES.map((f) => ({ externalId: f.externalId, payload: f.payload })));
  },
};
