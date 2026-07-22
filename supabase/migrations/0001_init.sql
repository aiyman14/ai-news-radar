-- ============================================================================
-- 0001_init.sql — ai-news-radar schema
-- Content tables only: the dashboard is PUBLIC-READ. Two-layer access model:
--   anon          → SELECT on every content table (RLS policies + grants)
--   service_role  → full DML (the ingestion writer; bypasses RLS)
-- Conventions: timestamptz (UTC) everywhere; UUID PKs; RLS ON for all tables.
-- Notes: `kind` is text + CHECK (not a PG enum) so adding a kind is a
--        one-line migration. Circular FK normalized_items <-> story_clusters
--        is resolved via ALTER after both tables exist.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Content tables (written only by the service role)
-- ----------------------------------------------------------------------------

create table public.sources (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  type              text not null,          -- 'rss' | 'github_releases' | 'hn' | 'changelog' | 'huggingface' | 'placeholder' | 'fake'
  name              text not null,
  url               text,                   -- canonical URL or feed URL
  config            jsonb not null default '{}',
  trust_score       int not null default 5 check (trust_score between 1 and 10),
  default_kind_hint text,                   -- classifier prior, not an override
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

create table public.ingestion_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  trigger       text not null default 'cron' check ("trigger" in ('cron', 'manual')),
  items_fetched int not null default 0,
  items_new     int not null default 0,
  items_failed  int not null default 0,
  status        text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  notes         text
);

create table public.source_errors (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references public.ingestion_runs(id) on delete cascade,
  source_id   uuid references public.sources(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  phase       text not null check (phase in ('fetch', 'parse', 'normalize', 'persist', 'cluster', 'enrich', 'embed')),
  message     text not null,
  detail      jsonb
);

create index source_errors_run_idx on public.source_errors (run_id);
create index source_errors_source_idx on public.source_errors (source_id, occurred_at desc);

create table public.raw_items (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references public.ingestion_runs(id) on delete set null,
  source_id    uuid not null references public.sources(id) on delete cascade,
  external_id  text not null,               -- source-native ID (RSS guid, release id); adapters derive URL+hash when absent
  fetched_at   timestamptz not null default now(),
  payload      jsonb not null,              -- raw response, kept for reprocessing
  content_hash text,
  unique (source_id, external_id)
);

-- Created before normalized_items; representative_id is ALTERed in afterwards.
create table public.story_clusters (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  summary       text,
  tags          text[] not null default '{}',
  entities      text[] not null default '{}',
  item_count    int not null default 0,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  score         numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger story_clusters_set_updated_at
  before update on public.story_clusters
  for each row execute function public.set_updated_at();

create table public.normalized_items (
  id              uuid primary key default gen_random_uuid(),
  raw_item_id     uuid references public.raw_items(id) on delete cascade,
  source_id       uuid not null references public.sources(id) on delete cascade,
  source_type     text not null,            -- denormalized for fast filtering
  source_name     text not null,            -- denormalized
  external_id     text not null,
  canonical_url   text,
  title           text not null,
  body_text       text,
  body_html       text,
  image_url       text,                     -- primary thumbnail/hero image
  media           jsonb not null default '{}', -- {images:[], video_url, gallery} — extensible, no migration needed
  author_name     text,
  published_at    timestamptz,
  fetched_at      timestamptz not null default now(),
  language        text not null default 'en',
  tags            text[] not null default '{}',
  entities        text[] not null default '{}',
  engagement      jsonb,                    -- {likes, comments, score, ...}
  content_hash    text,
  kind            text not null default 'news'
                    check (kind in ('news', 'launch', 'tool', 'tip', 'discussion', 'research', 'opinion')),
  kind_confidence numeric not null default 0 check (kind_confidence between 0 and 1),
  fts             tsvector generated always as (
                    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, ''))
                  ) stored,
  score           numeric not null default 0,
  cluster_id      uuid references public.story_clusters(id) on delete set null,
  status          text not null default 'active' check (status in ('active', 'archived')),
  created_at      timestamptz not null default now(),
  -- LLM enrichment columns (bring-your-own-key; null = not yet processed).
  -- vector(1024) matches voyage-3.5-lite's native dims and
  -- text-embedding-3-small requested with dimensions=1024 — both providers
  -- emit the same shape, so switching vendors never rewrites the column.
  embedding       vector(1024),
  llm_summary     text,
  llm_enriched_at timestamptz,
  unique (source_id, external_id)
);

alter table public.story_clusters
  add column representative_id uuid references public.normalized_items(id) on delete set null;

-- Embedding ANN index: DELIBERATELY not created yet. Sequential scan beats
-- index maintenance below ~10k rows. When the corpus passes 10k, ship:
-- create index normalized_items_embedding_hnsw
--   on public.normalized_items using hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index normalized_items_published_idx  on public.normalized_items (published_at desc);
create index normalized_items_cluster_idx    on public.normalized_items (cluster_id);
create index normalized_items_source_idx     on public.normalized_items (source_id, fetched_at desc);
create index normalized_items_tags_gin       on public.normalized_items using gin (tags);
create index normalized_items_entities_gin   on public.normalized_items using gin (entities);
create index normalized_items_fts_gin        on public.normalized_items using gin (fts);
create index normalized_items_title_trgm     on public.normalized_items using gin (title gin_trgm_ops);
create index normalized_items_kind_idx       on public.normalized_items (kind, published_at desc);
create index story_clusters_score_idx        on public.story_clusters (score desc, last_seen_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security — ON for every table.
-- Public-read model: `anon` (and `authenticated`, for parity) may SELECT
-- every content table; there are NO client write policies at all. The only
-- writer is the ingestion job using the service role, which bypasses RLS.
-- ----------------------------------------------------------------------------

alter table public.sources          enable row level security;
alter table public.ingestion_runs   enable row level security;
alter table public.source_errors    enable row level security;
alter table public.raw_items        enable row level security;
alter table public.normalized_items enable row level security;
alter table public.story_clusters   enable row level security;

create policy "public read" on public.sources          for select to anon, authenticated using (true);
create policy "public read" on public.ingestion_runs   for select to anon, authenticated using (true);
create policy "public read" on public.source_errors    for select to anon, authenticated using (true);
create policy "public read" on public.raw_items        for select to anon, authenticated using (true);
create policy "public read" on public.normalized_items for select to anon, authenticated using (true);
create policy "public read" on public.story_clusters   for select to anon, authenticated using (true);

-- ----------------------------------------------------------------------------
-- Grants (table-level; RLS above is the row-level layer)
-- Newer Supabase images do NOT auto-grant table privileges on objects created
-- by migrations (default ACLs give API roles only TRUNCATE/REFERENCES/TRIGGER),
-- so every table needs explicit grants — matched exactly to the RLS surface.
-- NOTE for future migrations: new tables need their own grants too.
--   service_role       → full DML everywhere (the ingestion writer).
--   anon/authenticated → SELECT only (the public dashboard reader).
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public to service_role;

grant select on public.sources          to anon, authenticated;
grant select on public.ingestion_runs   to anon, authenticated;
grant select on public.source_errors    to anon, authenticated;
grant select on public.raw_items        to anon, authenticated;
grant select on public.normalized_items to anon, authenticated;
grant select on public.story_clusters   to anon, authenticated;
