# AI News Radar

**Live: https://aiyman14.github.io/ai-news-radar/**

A daily radar of what's happening in AI. Every morning a GitHub Actions job
pulls **32 free sources** (lab blogs, research newsletters, 16 subreddits,
Hugging Face trending, GitHub releases, Product Hunt), classifies every item
into one of **7 kinds**, deduplicates, clusters related coverage into
**stories**, scores them, and publishes the result as a static site.

No server. No database. No accounts, tracking or API keys. The only
infrastructure is this repository.

![radar workflow](https://github.com/aiyman14/ai-news-radar/actions/workflows/radar.yml/badge.svg)
![ci](https://github.com/aiyman14/ai-news-radar/actions/workflows/ci.yml/badge.svg)

## How it works

```
  GitHub Actions cron (06:00 UTC daily)
  │
  ├─ 1. ingest ─ fetch 32 sources ─► normalize ─► classify (7 kinds)
  │              ─► score ─► dedup ─► cluster (title-shingle Jaccard) ─► data/radar.json
  │
  ├─ 2. build ──  Next.js static export reads the snapshot ─► out/
  │               feed · kind pages · top stories · trending · story pages
  │               · source health · a browser-side search index
  │
  └─ 3. publish ─ out/ → gh-pages branch → GitHub Pages
```

Everything is stateless: the sources are the database, and today's radar
simply replaces yesterday's. Search and filters run in the browser over a
small JSON index, so the published site is plain HTML plus one data file.

## What's in the pipeline

**Adapters** turn each source type (RSS/Atom, the Hugging Face API, GitHub
releases) into a common item shape. Failures are typed `Result` values, not
exceptions: a feed that 404s is recorded and the run continues.

**Classification** assigns one of seven kinds with a deterministic
keyword/heuristic classifier, using the source's typical kind as a prior:

| kind | what it captures |
|---|---|
| `news` | announcements, funding, industry events |
| `launch` | model/product releases |
| `tool` | utilities, frameworks, apps |
| `tip` | tutorials, how-tos, practical guidance |
| `discussion` | debates, community threads |
| `research` | papers, technical results |
| `opinion` | essays, hot takes |

**Clustering** groups related coverage into stories: titles are
word-shingled (3-grams) and compared with Jaccard similarity over a 72-hour
window, grouped with union-find. The 0.4 threshold was calibrated against a
real corpus (cross-source duplicates at 1.0, release families at 0.4–0.7,
first false positives below 0.3). Each story keeps a representative item,
aggregate tags/entities and a recency/engagement-aware score.

**Trending** counts tags and entities over 24/48/72h windows and reports the
delta against the previous equal window.

**Optional LLM layer.** Per-item summaries and embeddings are built and
tested against deterministic fake providers and ship dormant; setting
`LLM_PROVIDER` + a key activates them with no code changes.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), pnpm monorepo |
| Pipeline | `@radar/core` — adapters, stages, in-memory repositories |
| Ingestion | `@radar/ingest` CLI, one stateless run per day |
| Web | Next.js App Router, static export, Tailwind design tokens |
| Hosting | GitHub Pages, published by the same workflow |
| Tests | Vitest, fixture-based adapter tests |
| CI | typecheck + tests + smoke ingest + build + gitleaks secret scan |

## Run it locally

Requires Node 20+ and pnpm. Nothing else.

```bash
pnpm install
pnpm ingest -- --source rss-openai,rss-deepmind   # a few sources, seconds
pnpm ingest                                        # all 32 (~9 min, paced for rate limits)
pnpm dev:web                                       # → http://localhost:3000
```

`pnpm -r typecheck` · `pnpm -r test` · `pnpm build:web` (static export in `apps/web/out`).

## Layout

```
apps/ingest     the CLI the workflow runs
apps/web        the dashboard (static export)
packages/core   sources, adapters, pipeline stages, repositories, snapshot
data/           radar.json — written by ingest, read by the build (gitignored)
```

## Roadmap

See [TODO.md](TODO.md): design pass, more sources (arXiv, Hacker News),
optional LLM summaries.

## License

[MIT](LICENSE) © 2026 Aiyman Akbar
