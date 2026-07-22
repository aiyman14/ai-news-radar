import type { Json, Kind } from "./item";

/**
 * Source transport types. 'fake' exists only for the disabled `fake-fixture`
 * seed row that proves the pipeline end-to-end; it never runs in cron.
 */
export const SOURCE_TYPES = [
  "rss",
  "github_releases",
  "hn",
  "changelog",
  "huggingface",
  "placeholder",
  "fake",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as readonly string[]).includes(value);
}

/** A source's typical kind — a classifier PRIOR, never an override. */
export type SourceKindHint = Kind;

/** A `sources` row in camelCase, as the pipeline consumes it. */
export interface SourceConfig {
  id: string;
  slug: string;
  type: SourceType;
  name: string;
  url: string | null;
  /** Per-adapter config (subreddit feed params, repos[], keyword_filter, …). */
  config: Record<string, Json>;
  trustScore: number;
  defaultKindHint: SourceKindHint | null;
  enabled: boolean;
}
