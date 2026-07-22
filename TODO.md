# TODO — roadmap

Self-orienting list for any session opened in this repo. Ordered roughly by
intent.

## 1. Live demo (Supabase cloud + Vercel)

Goal: a public URL anyone can open.

- [ ] Create a free-tier Supabase project; apply `supabase/migrations/0001_init.sql`
      + `supabase/seed/0001_sources.sql` (`supabase link` + `supabase db push`,
      then run the seed).
- [ ] Verify RLS: anon key can `SELECT` from `normalized_items`, cannot write.
- [ ] GitHub repo secrets for the ingest cron (`.github/workflows/ingest.yml`):
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `GH_RELEASES_PAT`
      (public_repo PAT → 5k/hr for the releases adapter). Run the workflow
      once manually (`workflow_dispatch`) to fill the feed (~9 min, paced).
- [ ] Vercel project on this repo, root `apps/web`; env vars
      `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [ ] Smoke: the public URL renders the feed with no cookie; /trending and a
      story page work; security headers present.

## 2. Visual design pass

The current UI is a functional token-based dark shell — deliberately
placeholder. All colors/spacing flow from CSS variables in
`apps/web/app/globals.css` (mapped in `tailwind.config.ts`); components
reference tokens only, so a restyle is mostly a token edit plus targeted
component polish (typography scale, card density, mobile nav).

## 3. LLM activation + semantic calibration

- [ ] Add a generation key (`LLM_PROVIDER` + key) → enrich stage writes
      per-item summaries; surface `llm_summary` in the UI (feed row expand /
      story page).
- [ ] Add an embeddings key (`EMBEDDINGS_PROVIDER` + key), backfill with
      `--reembed`, then calibrate `CLUSTER_SEMANTIC=1` against real pairs
      before enabling it in cron (the title-shingle threshold 0.4 was
      calibrated on real data; the cosine blend needs the same treatment).

## 4. Semantic search UI

With embeddings live: a search mode that embeds the query and ranks by
cosine distance (pgvector `<=>`), blended with FTS. Needs an RPC or API
route (PostgREST can't order by a computed vector distance), plus the HNSW
index once the corpus passes ~10k rows (see the note in the migration).

## 5. More sources

- [ ] arXiv (cs.AI / cs.LG / cs.CL) — RSS or API adapter, kind `research`.
- [ ] Hacker News — the `hn` adapter stub exists; front-page + "Show HN"
      filtered by AI keywords.
- [ ] Source audit: prune noisy feeds, tune per-source `trust_score`.
- [ ] "Best of day/week" digest page built on cluster scores.
