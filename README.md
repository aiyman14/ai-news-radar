# AI News Radar

An open-source AI-news dashboard. It ingests **32 free sources** every 12 hours,
normalizes and classifies everything into **7 content kinds**, deduplicates,
clusters related coverage into **stories**, scores them, and serves a fast,
public, read-only dashboard — no accounts, no tracking, no paywalls.

> **Status: working, work-in-progress.** The pipeline, clustering, and
> dashboard are functional end-to-end and covered by tests. The visual design
> is a deliberate token-based placeholder awaiting a proper design pass, and
> the LLM enrichment layer ships dormant (bring your own key). See
> [TODO.md](TODO.md) for the roadmap.

## Architecture

```
              ┌──────────────────────────────────────────────────┐
              │                sources (32 seeded)               │
              │  subreddit Atom · lab/media RSS · HF trending    │
              │  GitHub releases · Product Hunt (keyword-filter) │
              └───────────────────────┬──────────────────────────┘
                                      │ adapters (pacing, retry,
                                      │ typed Result errors)
                                      ▼
   ingest CLI ──► fetch ─► normalize ─► classify ─► score ─► dedup ─► persist
 (GH Actions cron)                                                      │
                                                                        ▼
                                              ┌─────────────── Postgres (Supabase)
                                              │   raw_items · normalized_items
                                              │   story_clusters · runs · errors
                                              ▼
                    post-persist stages: enrich (LLM) ─► embed (pgvector)
                                         ─► cluster (title-shingle Jaccard)
                                              │
                                              ▼
                     Next.js dashboard (public read via anon key + RLS)
                     feed · kind tabs · search · filters · top stories
                     trending · story pages · source health
```

**Design principles**

- **Errors are data.** Expected failures (a feed 404s, a payload won't parse)
  are typed `Result` values recorded to `source_errors`; the run continues.
  `throw` is reserved for bugs and misconfiguration.
- **Idempotent everywhere.** Dedup is keyed on `(source_id, external_id)`;
  clustering fully recomputes cluster upkeep so re-runs converge; enrichment
  is processed-once keyed on null columns.
- **Two-layer access.** RLS is ON for every table with anon `SELECT` policies
  plus matching table grants; the only writer is the ingestion job's service
  role. The web app never touches a privileged key.
- **Dependency-absent design.** The LLM layer was built and tested against
  deterministic fake providers — adding a real API key activates it with
  zero code changes.

## The 7 kinds + clustering

Every item is classified into one of seven kinds by a deterministic
keyword/heuristic classifier (an optional LLM pass can refine it):

| kind | what it captures |
|---|---|
| `news` | announcements, funding, industry events |
| `launch` | model/product releases |
| `tool` | utilities, frameworks, apps |
| `tip` | tutorials, how-tos, practical guidance |
| `discussion` | debates, community threads |
| `research` | papers, technical results |
| `opinion` | essays, hot takes |

Related coverage is clustered into **stories**: titles are word-shingled and
compared with Jaccard similarity (threshold 0.4, calibrated against real
data) over a 72-hour window, grouped with union-find, and merged when new
items bridge existing clusters. Each cluster keeps a representative item,
aggregate tags/entities, and a recency/engagement-aware score. An optional
semantic assist blends embedding cosine similarity in once live embeddings
exist.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), pnpm monorepo |
| Pipeline | `@radar/core` — adapters, stages, repositories |
| Ingestion | `@radar/ingest` CLI, GitHub Actions cron (every 12h) |
| Database | Supabase Postgres (RLS, FTS, pg_trgm, pgvector) |
| Web | Next.js App Router (server components), Tailwind design tokens |
| LLM (optional) | Anthropic / OpenAI generation · Voyage / OpenAI embeddings |
| Tests | Vitest (137 tests), fixture-based adapter tests |
| CI | typecheck + tests + build + gitleaks secret scan |

## Run it locally

Requires Node 20+ (22 recommended), pnpm, and Docker (for local Supabase).

```bash
pnpm install
pnpm db:start                      # local Supabase stack; prints URL + keys
pnpm db:reset                      # applies the migration + seeds 32 sources
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<service_role key from db:start output>

# prove the pipeline end-to-end with the fake fixture (writes real rows):
pnpm --filter @radar/ingest dev -- --source fake-fixture

# ingest a real source:
pnpm --filter @radar/ingest dev -- --source rss-openai

# run everything (a full sweep paces rate-limited hosts and takes ~9 min):
pnpm --filter @radar/ingest dev

# dashboard:
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from db:start output>
pnpm dev:web                       # → http://localhost:3000
```

Checks: `pnpm -r typecheck` · `pnpm -r test`.

## LLM enrichment: bring your own key

The intelligence layer is **dormant by default** — every stage skips
gracefully with a logged notice when unconfigured. To activate (Anthropic or
OpenAI for generation; Voyage or OpenAI for embeddings):

```bash
LLM_PROVIDER=anthropic  ANTHROPIC_API_KEY=...   # per-item summaries
EMBEDDINGS_PROVIDER=voyage  VOYAGE_API_KEY=...  # 1024-dim pgvector embeddings
```

Runs are capped by `LLM_MAX_ITEMS_PER_RUN` (default 400), items are
processed once, and `--reenrich` / `--reembed` backfill an existing corpus.
Providers are plain-fetch implementations behind one interface — swapping
vendors is configuration, not a refactor.

## Roadmap

See [TODO.md](TODO.md): live demo deployment, visual design pass, LLM
activation + semantic calibration, semantic search UI, more sources
(arXiv, Hacker News).

## License

[MIT](LICENSE) © 2026 Aiyman Akbar
