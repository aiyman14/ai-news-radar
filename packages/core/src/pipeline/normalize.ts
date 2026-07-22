import type { Json, NormalizedDraft, RawItem } from "../types/item";
import type { SourceConfig } from "../types/source";
import { err, ok, type Result } from "../types/result";
import { NormalizeError } from "../errors";
import { contentHash } from "../util/hash";

/**
 * Raw payload -> NormalizedDraft.
 *
 * Scaffold version: handles the "common payload" convention
 * ({title, url, body, body_html, image_url, author, published_at, engagement})
 * which the fake adapter emits and simple adapters MAY emit directly.
 * Future work extends this with per-source-type mappers
 * (Reddit t3 shape, RSS entry shape, GitHub release shape, ...).
 */

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(payload: { [key: string]: Json }, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeRawItem(
  source: SourceConfig,
  raw: RawItem,
): Result<NormalizedDraft, NormalizeError> {
  if (!isRecord(raw.payload)) {
    return err(
      new NormalizeError("payload_shape", `payload for ${raw.externalId} is not an object`, {
        externalId: raw.externalId,
      }),
    );
  }
  const p = raw.payload;

  const title = str(p, "title");
  if (!title) {
    return err(
      new NormalizeError("missing_title", `item ${raw.externalId} has no title`, {
        externalId: raw.externalId,
      }),
    );
  }

  const canonicalUrl = str(p, "url") ?? str(p, "link");
  const bodyText = str(p, "body") ?? str(p, "body_text");
  const engagement = isRecord(p["engagement"]) ? p["engagement"] : null;
  const media = isRecord(p["media"]) ? p["media"] : {};

  const draft: NormalizedDraft = {
    externalId: raw.externalId,
    canonicalUrl,
    title,
    bodyText,
    bodyHtml: str(p, "body_html"),
    imageUrl: str(p, "image_url"),
    media,
    authorName: str(p, "author"),
    publishedAt: parseDate(str(p, "published_at")),
    language: str(p, "language") ?? "en",
    tags: [], // filled by enrich
    entities: [], // filled by enrich
    engagement,
    contentHash: contentHash([title, bodyText, canonicalUrl]),
    kind: source.defaultKindHint ?? "news", // refined by classify
    kindConfidence: 0,
    score: 0, // filled by score
  };
  return ok(draft);
}
