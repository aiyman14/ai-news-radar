# @radar/ingest — the ingestion runner

One stateless run: fetch → normalize → classify → score → dedup (within the
run) → cluster, then serialize everything to `data/radar.json` for the web
build. Scheduled daily by `.github/workflows/radar.yml`; also the local dev
runner. No database, no credentials, nothing persists between runs.

```bash
pnpm --filter @radar/ingest dev                         # all 40 sources (paced)
pnpm --filter @radar/ingest dev -- --source rss-openai  # one source, fast
pnpm --filter @radar/ingest dev -- --dry-run            # fake fixture, writes nothing
```

| Flag | Meaning |
|---|---|
| `--trigger cron\|manual` | recorded on the run row |
| `--source a,b,c` | run only these slugs (includes disabled ones like `fake-fixture`) |
| `--limit N` | cap items per source |
| `--out FILE` | snapshot path (default `<repo>/data/radar.json`) |
| `--dry-run` | fake fixture only; nothing written |

Env: `RADAR_SNAPSHOT` is the env twin of `--out`; `INGEST_LIMIT_SOURCES` of
`--source`; `GITHUB_TOKEN` raises the releases adapter's rate limit; the
`LLM_*` / `EMBEDDINGS_*` variables activate the optional intelligence stages
(see the root README).

Failure policy: a failing source is recorded and the run continues
(`partial`). Exit code is non-zero only when every source failed.
