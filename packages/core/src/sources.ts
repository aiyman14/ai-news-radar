import type { SourceConfig } from "./types/source";

/**
 * The tracked sources — the ONLY place sources are defined.
 * 16 subreddits (public Atom feeds) + 18 RSS/Atom (lab blogs, media,
 * newsletters, research) + 2 community (Hacker News, Lobsters) + 2 Hugging
 * Face + 1 GitHub releases sweep + 1 Product Hunt = 40 enabled sources,
 * plus ONE disabled `fake-fixture` row that lets the fake adapter prove the
 * pipeline end-to-end without touching the network (runs only when named
 * via --source / INGEST_LIMIT_SOURCES).
 *
 * Reachability from GitHub-hosted runners (probed 2026-10-20 with the
 * `probe` workflow): every feed below answered 200 except Reddit, which
 * blocks some runner IP ranges outright ("403 Blocked") — it works on some
 * days and fails fast on others, so nothing here depends on it. Feeds that
 * were blocked on every runner (VentureBeat 429, Import AI / The Batch
 * behind a Cloudflare challenge) are not listed.
 *
 * `id` doubles as the slug: with a JSON store there is no surrogate key,
 * and a human-readable id keeps `data/` diffs legible.
 */

const reddit = (
  slug: string,
  subreddit: string,
  trustScore: number,
  defaultKindHint: SourceConfig["defaultKindHint"],
): SourceConfig => ({
  id: slug,
  slug,
  type: "rss",
  name: `r/${subreddit}`,
  // Reddit's API gates new apps behind manual approval, so these ride the
  // public per-subreddit Atom feeds. The feeds carry no vote scores, so
  // engagement is null for these sources.
  url: `https://www.reddit.com/r/${subreddit}/top/.rss?t=day&limit=50`,
  config: { subreddit, listing: "top", t: "day", min_score: 0 },
  trustScore,
  defaultKindHint,
  enabled: true,
});

const rss = (
  slug: string,
  name: string,
  url: string,
  trustScore: number,
  defaultKindHint: SourceConfig["defaultKindHint"],
  config: SourceConfig["config"] = {},
): SourceConfig => ({
  id: slug,
  slug,
  type: "rss",
  name,
  url,
  config,
  trustScore,
  defaultKindHint,
  enabled: true,
});

export const SOURCES: readonly SourceConfig[] = [
  // ── Reddit (16) ─────────────────────────────────────────────────────────
  reddit("reddit-localllama", "LocalLLaMA", 8, "launch"),
  reddit("reddit-machinelearning", "MachineLearning", 8, "news"),
  reddit("reddit-openai", "OpenAI", 7, "news"),
  reddit("reddit-claudeai", "ClaudeAI", 7, "launch"),
  reddit("reddit-stablediffusion", "StableDiffusion", 7, "tool"),
  reddit("reddit-promptengineering", "PromptEngineering", 6, "tip"),
  reddit("reddit-geminiai", "GeminiAI", 6, "news"),
  reddit("reddit-anthropic", "Anthropic", 6, "news"),
  reddit("reddit-mistralai", "MistralAI", 6, "launch"),
  reddit("reddit-deepseek", "DeepSeek", 6, "launch"),
  reddit("reddit-qwen", "Qwen_AI", 6, "launch"),
  reddit("reddit-comfyui", "comfyui", 6, "tip"),
  reddit("reddit-ai-agents", "AI_Agents", 6, "tool"),
  reddit("reddit-claudecode", "ClaudeCode", 6, "tip"),
  reddit("reddit-perplexity", "perplexity_ai", 5, "news"),
  reddit("reddit-kimi", "kimi", 5, "launch"),

  // ── RSS / Atom (18) — labs, media, newsletters, research ────────────────
  rss("rss-openai", "OpenAI News", "https://openai.com/news/rss.xml", 8, "news"),
  rss("rss-deepmind", "Google DeepMind", "https://deepmind.google/blog/rss.xml", 8, "news"),
  rss("rss-google-ai", "Google — The Keyword (AI)", "https://blog.google/technology/ai/rss/", 7, "news"),
  rss("rss-google-research", "Google Research", "https://research.google/blog/rss/", 8, "research"),
  rss("rss-huggingface-blog", "Hugging Face Blog", "https://huggingface.co/blog/feed.xml", 8, "tool"),
  rss("rss-mistral", "Mistral AI", "https://mistral.ai/rss.xml", 7, "launch"),
  rss("rss-nvidia-dev", "NVIDIA Developer Blog", "https://developer.nvidia.com/blog/feed", 6, "tip", { keyword_filter: "ai" }),
  rss("rss-techcrunch-ai", "TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", 6, "news"),
  rss("rss-theverge-ai", "The Verge AI", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", 6, "news"),
  rss("rss-arstechnica-ai", "Ars Technica AI", "https://arstechnica.com/ai/feed/", 7, "news"),
  rss("rss-wired-ai", "Wired AI", "https://www.wired.com/feed/tag/ai/latest/rss", 6, "news"),
  rss("rss-marktechpost", "MarkTechPost", "https://www.marktechpost.com/feed/", 5, "news"),
  rss("rss-mit-tech-review-ai", "MIT Tech Review AI", "https://www.technologyreview.com/topic/artificial-intelligence/feed", 7, "news"),
  rss("rss-the-gradient", "The Gradient", "https://thegradient.pub/rss/", 7, "discussion"),
  rss("rss-simon-willison", "Simon Willison", "https://simonwillison.net/atom/everything/", 8, "tip"),
  rss("rss-latent-space", "Latent Space", "https://www.latent.space/feed", 7, "discussion"),
  rss("rss-ahead-of-ai", "Ahead of AI (Raschka)", "https://magazine.sebastianraschka.com/feed", 7, "tip"),
  // arXiv lists hundreds of new cs.AI papers a day; cap keeps the feed sane.
  rss("rss-arxiv-cs-ai", "arXiv cs.AI", "https://rss.arxiv.org/rss/cs.AI", 7, "research", { max_items: 40 }),

  // ── Community (2) — the ones that are reachable from any runner ──────────
  rss("hn-frontpage", "Hacker News (AI)", "https://news.ycombinator.com/rss", 7, "discussion", { keyword_filter: "ai" }),
  rss("lobsters-ai", "Lobsters (AI)", "https://lobste.rs/t/ai.rss", 6, "discussion"),

  // ── Hugging Face JSON APIs (2) — no auth ────────────────────────────────
  {
    id: "hf-trending-models",
    slug: "hf-trending-models",
    type: "huggingface",
    name: "HF Trending Models",
    url: "https://huggingface.co/api/models?sort=trendingScore&limit=30",
    config: { endpoint: "models", sort: "trendingScore", limit: 30 },
    trustScore: 7,
    defaultKindHint: "launch",
    enabled: true,
  },
  {
    id: "hf-trending-spaces",
    slug: "hf-trending-spaces",
    type: "huggingface",
    name: "HF Trending Spaces",
    url: "https://huggingface.co/api/spaces?sort=trendingScore&limit=30",
    config: { endpoint: "spaces", sort: "trendingScore", limit: 30 },
    trustScore: 6,
    defaultKindHint: "tool",
    enabled: true,
  },

  // ── GitHub releases (1 source, 12 tracked repos) — PAT optional ─────────
  {
    id: "github-releases-ai",
    slug: "github-releases-ai",
    type: "github_releases",
    name: "AI tooling releases",
    url: "https://api.github.com",
    config: {
      per_page: 5,
      repos: [
        "ollama/ollama",
        "vllm-project/vllm",
        "ggml-org/llama.cpp",
        "comfyanonymous/ComfyUI",
        "huggingface/transformers",
        "langchain-ai/langchain",
        "run-llama/llama_index",
        "unslothai/unsloth",
        "openai/openai-python",
        "anthropics/anthropic-sdk-python",
        "google-gemini/generative-ai-python",
        "QwenLM/Qwen",
      ],
    },
    trustScore: 7,
    defaultKindHint: "launch",
    enabled: true,
  },

  // ── Product Hunt (1) — global Atom feed, client-side AI keyword filter ──
  rss("producthunt-ai", "Product Hunt (AI-filtered)", "https://www.producthunt.com/feed", 5, "launch", {
    keyword_filter: "ai",
  }),

  // ── Test fixture (NOT one of the 32; disabled) ──────────────────────────
  {
    id: "fake-fixture",
    slug: "fake-fixture",
    type: "fake",
    name: "Fake fixture source",
    url: null,
    config: {},
    trustScore: 5,
    defaultKindHint: "news",
    enabled: false,
  },
];

/** Lookup by slug (undefined when unknown). */
export function findSource(slug: string): SourceConfig | undefined {
  return SOURCES.find((s) => s.slug === slug);
}
