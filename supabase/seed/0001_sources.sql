-- ============================================================================
-- 0001_sources.sql — the 32 tracked sources
-- 16 subreddits (public Atom feeds) + 12 RSS + 2 Hugging Face + 1 GitHub
-- releases sweep + 1 Product Hunt.
-- Idempotent: re-running updates rows in place (safe with `supabase db reset`).
-- Plus ONE extra disabled row (`fake-fixture`) — NOT one of the 32; it exists
-- so the fake adapter can prove the pipeline end-to-end without touching real
-- sources. It only runs when explicitly named via --source / INGEST_LIMIT_SOURCES.
-- ============================================================================

insert into public.sources (slug, type, name, url, config, trust_score, default_kind_hint, enabled)
values
  -- ── Reddit (16) — via public Atom feeds (type 'rss') ─────────────────────
  -- Reddit's API gates new apps behind manual approval, so these ride the
  -- public per-subreddit Atom feeds instead. Note: the feeds carry no vote
  -- scores, so min_score is inert and engagement is null for these sources.
  ('reddit-localllama',        'rss', 'r/LocalLLaMA',        'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day&limit=50',        '{"subreddit": "LocalLLaMA",        "listing": "top", "t": "day", "min_score": 0}', 8, 'launch',     true),
  ('reddit-machinelearning',   'rss', 'r/MachineLearning',   'https://www.reddit.com/r/MachineLearning/top/.rss?t=day&limit=50',   '{"subreddit": "MachineLearning",   "listing": "top", "t": "day", "min_score": 0}', 8, 'news',       true),
  ('reddit-openai',            'rss', 'r/OpenAI',            'https://www.reddit.com/r/OpenAI/top/.rss?t=day&limit=50',            '{"subreddit": "OpenAI",            "listing": "top", "t": "day", "min_score": 0}', 7, 'news',       true),
  ('reddit-claudeai',          'rss', 'r/ClaudeAI',          'https://www.reddit.com/r/ClaudeAI/top/.rss?t=day&limit=50',          '{"subreddit": "ClaudeAI",          "listing": "top", "t": "day", "min_score": 0}', 7, 'launch',     true),
  ('reddit-stablediffusion',   'rss', 'r/StableDiffusion',   'https://www.reddit.com/r/StableDiffusion/top/.rss?t=day&limit=50',   '{"subreddit": "StableDiffusion",   "listing": "top", "t": "day", "min_score": 0}', 7, 'tool',       true),
  ('reddit-promptengineering', 'rss', 'r/PromptEngineering', 'https://www.reddit.com/r/PromptEngineering/top/.rss?t=day&limit=50', '{"subreddit": "PromptEngineering", "listing": "top", "t": "day", "min_score": 0}', 6, 'tip',        true),
  ('reddit-geminiai',          'rss', 'r/GeminiAI',          'https://www.reddit.com/r/GeminiAI/top/.rss?t=day&limit=50',          '{"subreddit": "GeminiAI",          "listing": "top", "t": "day", "min_score": 0}', 6, 'news',       true),
  ('reddit-anthropic',         'rss', 'r/Anthropic',         'https://www.reddit.com/r/Anthropic/top/.rss?t=day&limit=50',         '{"subreddit": "Anthropic",         "listing": "top", "t": "day", "min_score": 0}', 6, 'news',       true),
  ('reddit-mistralai',         'rss', 'r/MistralAI',         'https://www.reddit.com/r/MistralAI/top/.rss?t=day&limit=50',         '{"subreddit": "MistralAI",         "listing": "top", "t": "day", "min_score": 0}', 6, 'launch',     true),
  ('reddit-deepseek',          'rss', 'r/DeepSeek',          'https://www.reddit.com/r/DeepSeek/top/.rss?t=day&limit=50',          '{"subreddit": "DeepSeek",          "listing": "top", "t": "day", "min_score": 0}', 6, 'launch',     true),
  ('reddit-qwen',              'rss', 'r/Qwen_AI',           'https://www.reddit.com/r/Qwen_AI/top/.rss?t=day&limit=50',           '{"subreddit": "Qwen_AI",           "listing": "top", "t": "day", "min_score": 0}', 6, 'launch',     true),
  ('reddit-comfyui',           'rss', 'r/comfyui',           'https://www.reddit.com/r/comfyui/top/.rss?t=day&limit=50',           '{"subreddit": "comfyui",           "listing": "top", "t": "day", "min_score": 0}', 6, 'tip',        true),
  ('reddit-ai-agents',         'rss', 'r/AI_Agents',         'https://www.reddit.com/r/AI_Agents/top/.rss?t=day&limit=50',         '{"subreddit": "AI_Agents",         "listing": "top", "t": "day", "min_score": 0}', 6, 'tool',       true),
  ('reddit-claudecode',        'rss', 'r/ClaudeCode',        'https://www.reddit.com/r/ClaudeCode/top/.rss?t=day&limit=50',        '{"subreddit": "ClaudeCode",        "listing": "top", "t": "day", "min_score": 0}', 6, 'tip',        true),
  ('reddit-perplexity',        'rss', 'r/perplexity_ai',     'https://www.reddit.com/r/perplexity_ai/top/.rss?t=day&limit=50',     '{"subreddit": "perplexity_ai",     "listing": "top", "t": "day", "min_score": 0}', 5, 'news',       true),
  ('reddit-kimi',              'rss', 'r/kimi',              'https://www.reddit.com/r/kimi/top/.rss?t=day&limit=50',              '{"subreddit": "kimi",              "listing": "top", "t": "day", "min_score": 0}', 5, 'launch',     true),

  -- ── RSS / Atom (12) — lab blogs, media, newsletters ──────────────────────
  ('rss-openai',             'rss', 'OpenAI News',                'https://openai.com/news/rss.xml',                                    '{}', 8, 'news',       true),
  ('rss-deepmind',           'rss', 'Google DeepMind',            'https://deepmind.google/blog/rss.xml',                               '{}', 8, 'news',       true),
  ('rss-google-ai',          'rss', 'Google — The Keyword (AI)',  'https://blog.google/technology/ai/rss/',                             '{}', 7, 'news',       true),
  ('rss-huggingface-blog',   'rss', 'Hugging Face Blog',          'https://huggingface.co/blog/feed.xml',                               '{}', 8, 'tool',       true),
  ('rss-mistral',            'rss', 'Mistral AI',                 'https://mistral.ai/rss.xml',                                         '{}', 7, 'launch',     true),
  ('rss-techcrunch-ai',      'rss', 'TechCrunch AI',              'https://techcrunch.com/category/artificial-intelligence/feed/',     '{}', 6, 'news',       true),
  ('rss-venturebeat-ai',     'rss', 'VentureBeat AI',             'https://venturebeat.com/category/ai/feed/',                          '{}', 6, 'news',       true),
  ('rss-mit-tech-review-ai', 'rss', 'MIT Tech Review AI',         'https://www.technologyreview.com/topic/artificial-intelligence/feed','{}', 7, 'news',       true),
  ('rss-import-ai',          'rss', 'Import AI (Jack Clark)',     'https://importai.substack.com/feed',                                 '{}', 8, 'discussion', true),
  ('rss-simon-willison',     'rss', 'Simon Willison',             'https://simonwillison.net/atom/everything/',                         '{}', 8, 'tip',        true),
  ('rss-latent-space',       'rss', 'Latent Space',               'https://www.latent.space/feed',                                      '{}', 7, 'discussion', true),
  ('rss-ahead-of-ai',        'rss', 'Ahead of AI (Raschka)',      'https://magazine.sebastianraschka.com/feed',                         '{}', 7, 'tip',        true),

  -- ── Hugging Face JSON APIs (2) — no auth ─────────────────────────────────
  ('hf-trending-models', 'huggingface', 'HF Trending Models', 'https://huggingface.co/api/models?sort=trendingScore&limit=30', '{"endpoint": "models", "sort": "trendingScore", "limit": 30}', 7, 'launch', true),
  ('hf-trending-spaces', 'huggingface', 'HF Trending Spaces', 'https://huggingface.co/api/spaces?sort=trendingScore&limit=30', '{"endpoint": "spaces", "sort": "trendingScore", "limit": 30}', 6, 'tool',   true),

  -- ── GitHub releases (1 source, 12 tracked repos) — PAT optional ──────────
  ('github-releases-ai', 'github_releases', 'AI tooling releases', 'https://api.github.com',
   '{"per_page": 5, "repos": ["ollama/ollama", "vllm-project/vllm", "ggml-org/llama.cpp", "comfyanonymous/ComfyUI", "huggingface/transformers", "langchain-ai/langchain", "run-llama/llama_index", "unslothai/unsloth", "openai/openai-python", "anthropics/anthropic-sdk-python", "google-gemini/generative-ai-python", "QwenLM/Qwen"]}',
   7, 'launch', true),

  -- ── Product Hunt (1) — global Atom feed, client-side AI keyword filter ───
  ('producthunt-ai', 'rss', 'Product Hunt (AI-filtered)', 'https://www.producthunt.com/feed', '{"keyword_filter": "ai"}', 5, 'launch', true),

  -- ── Test fixture (NOT one of the 32; disabled) ───────────────────────────
  ('fake-fixture', 'fake', 'Fake fixture source', null, '{}', 5, 'news', false)

on conflict (slug) do update set
  type              = excluded.type,
  name              = excluded.name,
  url               = excluded.url,
  config            = excluded.config,
  trust_score       = excluded.trust_score,
  default_kind_hint = excluded.default_kind_hint,
  enabled           = excluded.enabled,
  updated_at        = now();
