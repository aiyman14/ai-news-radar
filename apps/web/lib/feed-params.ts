import { KINDS } from "./kinds";

/**
 * URL-driven search state. ALL search/filter state lives in the query
 * string of /search — shareable, back-button-safe, and resolved entirely in
 * the browser (the site is static HTML). This module is pure (usable from
 * server and client components): parse searchParams → FeedParams, and build
 * hrefs for toggles/removals.
 *
 * Params: q · kind (comma-separated multi) · source (slug) · range
 * (24h|48h|72h|7d) · img=1 · clustered=1 · tag · entity · page
 */

export const SEARCH_PATH = "/search";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const RANGES = ["24h", "48h", "72h", "7d"] as const;
export const RANGE_HOURS: Record<string, number> = {
  "24h": 24,
  "48h": 48,
  "72h": 72,
  "7d": 168,
};
export const RANGE_LABEL: Record<string, string> = {
  "24h": "Last 24h",
  "48h": "Last 48h",
  "72h": "Last 72h",
  "7d": "Last 7 days",
};

export interface FeedParams {
  q: string;
  kinds: string[];
  source: string;
  range: string; // "" = all time
  img: boolean;
  clustered: boolean;
  tag: string;
  entity: string;
  page: number;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseFeedParams(raw: RawSearchParams | URLSearchParams): FeedParams {
  if (raw instanceof URLSearchParams) {
    const obj: RawSearchParams = {};
    for (const [k, v] of raw.entries()) obj[k] = v;
    raw = obj;
  }
  const kindsRaw = Array.isArray(raw.kind) ? raw.kind.join(",") : (raw.kind ?? "");
  const kinds = kindsRaw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => (KINDS as readonly string[]).includes(k));
  const range = first(raw.range);
  return {
    q: first(raw.q),
    kinds: [...new Set(kinds)],
    source: first(raw.source),
    range: range in RANGE_HOURS ? range : "",
    img: first(raw.img) === "1",
    clustered: first(raw.clustered) === "1",
    tag: first(raw.tag),
    entity: first(raw.entity),
    page: Math.max(1, Number(first(raw.page)) || 1),
  };
}

/**
 * Build a /search href from params + overrides. Any filter change resets the
 * page (override `page` explicitly for pagination links).
 */
export function feedHref(params: FeedParams, overrides: Partial<FeedParams> = {}): string {
  const p: FeedParams = { ...params, page: 1, ...overrides };
  const search = new URLSearchParams();
  if (p.q) search.set("q", p.q);
  if (p.kinds.length > 0) search.set("kind", p.kinds.join(","));
  if (p.source) search.set("source", p.source);
  if (p.range) search.set("range", p.range);
  if (p.img) search.set("img", "1");
  if (p.clustered) search.set("clustered", "1");
  if (p.tag) search.set("tag", p.tag);
  if (p.entity) search.set("entity", p.entity);
  if (p.page > 1) search.set("page", String(p.page));
  const qs = search.toString();
  return qs ? `${SEARCH_PATH}?${qs}` : SEARCH_PATH;
}

/** Toggle one kind in the multi-select chip row. */
export function toggleKindHref(params: FeedParams, kind: string): string {
  const kinds = params.kinds.includes(kind)
    ? params.kinds.filter((k) => k !== kind)
    : [...params.kinds, kind];
  return feedHref(params, { kinds });
}

/** True when any search/filter (not pagination) is active. */
export function hasActiveFilters(p: FeedParams): boolean {
  return Boolean(
    p.q ||
      p.kinds.length > 0 ||
      p.source ||
      p.range ||
      p.img ||
      p.clustered ||
      p.tag ||
      p.entity,
  );
}
