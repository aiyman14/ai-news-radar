/**
 * Snake_case row shapes — the snapshot format (written by the ingest run,
 * read by apps/web at build time). The SQL-flavored naming is historical:
 * these started life as Postgres rows.
 */
import type { Json } from "./item";

export interface SourceRow {
  id: string;
  slug: string;
  type: string;
  name: string;
  url: string | null;
  config: Record<string, Json>;
  trust_score: number;
  default_kind_hint: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface IngestionRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  items_fetched: number;
  items_new: number;
  items_failed: number;
  status: string;
  notes: string | null;
}

export interface SourceErrorRow {
  id: string;
  run_id: string | null;
  source_id: string | null;
  occurred_at: string;
  phase: string;
  message: string;
  detail: Json | null;
}

export interface RawItemRow {
  id: string;
  run_id: string | null;
  source_id: string;
  external_id: string;
  fetched_at: string;
  payload: Json;
  content_hash: string | null;
}

export interface NormalizedItemRow {
  id: string;
  raw_item_id: string | null;
  source_id: string;
  source_type: string;
  source_name: string;
  external_id: string;
  canonical_url: string | null;
  title: string;
  body_text: string | null;
  body_html: string | null;
  image_url: string | null;
  media: Record<string, Json>;
  author_name: string | null;
  published_at: string | null;
  fetched_at: string;
  language: string;
  tags: string[];
  entities: string[];
  engagement: Record<string, Json> | null;
  content_hash: string | null;
  kind: string;
  kind_confidence: number;
  score: number;
  cluster_id: string | null;
  status: string;
  created_at: string;
  // LLM enrichment columns — null until processed.
  embedding: number[] | null;
  llm_summary: string | null;
  llm_enriched_at: string | null;
}

export interface StoryClusterRow {
  id: string;
  representative_id: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
  entities: string[];
  item_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  score: number;
  created_at: string;
  updated_at: string;
}
