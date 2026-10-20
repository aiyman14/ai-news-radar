# AI News Radar

**Live: https://aiyman14.github.io/ai-news-radar/**

A daily radar of what's happening in AI. Once a day it pulls 40 free sources
(lab blogs, tech media, research feeds, Hacker News, Lobsters, subreddits,
Hugging Face trending, GitHub releases, Product Hunt), sorts everything into
seven kinds, groups related coverage into stories, and publishes the result
as a static site.

No server, no database, no accounts, no tracking, no API keys. The whole
thing runs on GitHub: Actions does the work, Pages serves the result.

![radar](https://github.com/aiyman14/ai-news-radar/actions/workflows/radar.yml/badge.svg)
![ci](https://github.com/aiyman14/ai-news-radar/actions/workflows/ci.yml/badge.svg)

## What it does

- **Feed** of the last 14 days across every source, with kind tabs and paging.
- **Stories** where several sources cover the same thing, with a score and the
  full coverage list.
- **Trending** topics and entities over 24/48/72 hours, with the change
  against the previous window.
- **Search** and filters (kind, source, date range, tag, entity) that run in
  the browser.
- **Tools**, **Tips** and **Sources** views, the last one showing what each
  source delivered in the latest run.

Items are classified into `news`, `launch`, `tool`, `tip`, `discussion`,
`research` or `opinion` by a deterministic keyword classifier that uses each
source's usual kind as a prior.

## How it works

```
GitHub Actions, 06:00 UTC daily
│
├─ ingest   fetch 40 sources → normalize → classify → score → dedup → cluster
│           everything in memory, then one JSON snapshot (14-day window)
│
├─ build    Next.js static export reads the snapshot → plain HTML
│           plus a small JSON index for browser-side search
│
└─ publish  out/ → gh-pages branch → GitHub Pages
```

Each run is stateless: the sources are the database, and today's radar
replaces yesterday's. A feed that fails is recorded and skipped; the run goes
on. Reddit blocks some GitHub runner IPs, so the subreddit feeds are
best-effort and the radar is designed to be complete without them.

**Stories** come from title similarity: titles are split into 3-word
shingles and compared with Jaccard similarity over a 72-hour window; items
above the 0.4 threshold (calibrated on real data) are grouped with
union-find. Each story keeps a representative item, merged tags and entities,
and a recency- and engagement-aware score.

## Stack

TypeScript monorepo (pnpm). `packages/core` holds the sources, adapters
(RSS/Atom, Hugging Face API, GitHub releases), pipeline stages and tests;
`apps/ingest` is the CLI the workflow runs; `apps/web` is the Next.js
dashboard. CI runs typecheck, tests, a smoke ingest, the build, and a secret
scan. An optional LLM layer (summaries, embeddings) ships dormant and
activates with an API key.

## License

[MIT](LICENSE) © 2026 Aiyman Akbar
