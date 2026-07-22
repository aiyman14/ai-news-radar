# @radar/ingest — the ingestion runner

Runs the pipeline: fetch → normalize → classify → score → dedup → persist,
then the post-persist stages (LLM enrich → embed → cluster). Scheduled by
`.github/workflows/ingest.yml` (every 12h + manual dispatch); also the local
dev runner.

## Local dev (against local Supabase — needs Docker)

```bash
supabase start                      # boots local Postgres (Docker)
supabase db reset                   # applies migrations + seed (32 sources + fake-fixture)
# put the printed URL + service_role key into .env or export them:
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<from supabase start output>

# end-to-end proof with the fake adapter (writes real rows):
pnpm --filter @radar/ingest dev -- --source fake-fixture

# scope any run to specific sources:
INGEST_LIMIT_SOURCES=rss-openai pnpm --filter @radar/ingest dev
```

## Without Docker / without a DB

```bash
pnpm --filter @radar/ingest dev -- --dry-run   # in-memory repos, fake adapter only
```

## Flags

| Flag | Meaning |
|---|---|
| `--trigger cron\|manual` | recorded on the `ingestion_runs` row |
| `--source a,b,c` | run only these slugs (includes disabled ones like `fake-fixture`) |
| `--limit N` | cap items per source |
| `--dry-run` | in-memory repos; nothing written |
| `--recluster` | run ONLY the cluster stage over the recent window |
| `--reenrich` | run ONLY the LLM enrich stage in backfill mode (capped per invocation) |
| `--reembed` | run ONLY the embed stage in backfill mode |

Failure policy: per-source errors land in `source_errors` and the run continues
(`partial`). Exit code is non-zero only when the whole run `failed`.
