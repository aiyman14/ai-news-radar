import type { SourceAdapter, FetchContext } from "../types";
import type { Json, RawItem } from "../../types/item";
import type { SourceConfig } from "../../types/source";
import { err, ok, type Result } from "../../types/result";
import { FetchError } from "../../errors";

/**
 * Hugging Face trending adapter.
 *
 * - GETs source.url (seeded: /api/models?sort=trendingScore&limit=30 and
 *   /api/spaces?sort=trendingScore&limit=30). No auth; honest User-Agent.
 * - config.endpoint ("models" | "spaces") distinguishes the two mappings:
 *   URL = https://huggingface.co/<id> for models,
 *   https://huggingface.co/spaces/<id> for spaces; body carries pipeline_tag
 *   (models) / sdk (spaces).
 * - externalId = item.id (e.g. "meta-llama/Llama-4").
 * - Emits the "common payload" convention pipeline/normalize.ts understands
 *   (title/url/body/author/published_at + engagement
 *   {likes, downloads, trendingScore}).
 * - 15s AbortController timeout; expected failures (HTTP >=400, timeout,
 *   malformed JSON) => err(FetchError); NEVER throws.
 */

const FETCH_TIMEOUT_MS = 15_000;
const HF_BASE = "https://huggingface.co";
const USER_AGENT = "ai-news-radar:ingest:v0 (AI news feed reader)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** ISO date -> ISO UTC string, or null when absent/unparseable. */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

async function fetchListing(url: string): Promise<Result<Record<string, unknown>[], FetchError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
    });
    if (!res.ok) {
      return err(
        new FetchError("http_status", `huggingface API responded ${res.status} ${res.statusText}`, {
          url,
          status: res.status,
        }),
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      return err(
        new FetchError("parse_json", `huggingface response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { url }),
      );
    }
    if (!Array.isArray(json)) {
      return err(new FetchError("parse_json", "huggingface response parsed to a non-array", { url }));
    }
    return ok(json.filter(isRecord));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(
        new FetchError("timeout", `huggingface fetch timed out after ${FETCH_TIMEOUT_MS}ms`, { url }),
      );
    }
    return err(
      new FetchError("network", `huggingface fetch failed: ${e instanceof Error ? e.message : String(e)}`, { url }),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One trending entry -> RawItem (common payload). Null when it has no id. */
function toRawItem(entry: Record<string, unknown>, endpoint: string): RawItem | null {
  const id = str(entry["id"]);
  if (!id) return null; // no id -> can't dedup or link; skip defensively

  const isSpace = endpoint === "spaces";
  const url = isSpace ? `${HF_BASE}/spaces/${id}` : `${HF_BASE}/${id}`;
  // models carry pipeline_tag ("text-generation"); spaces carry sdk ("gradio")
  const detail = isSpace ? str(entry["sdk"]) : str(entry["pipeline_tag"]);
  // "org/name" ids: the org is the author; HF sometimes sends it explicitly
  const author = str(entry["author"]) ?? (id.includes("/") ? id.split("/")[0]! : null);

  const payload: Json = {
    title: id,
    url,
    body: detail,
    body_html: null,
    image_url: null,
    author,
    published_at: toIso(str(entry["createdAt"])),
    engagement: {
      likes: num(entry["likes"]) ?? 0,
      downloads: num(entry["downloads"]) ?? 0,
      trendingScore: num(entry["trendingScore"]) ?? 0,
    },
    endpoint,
  };
  return { externalId: id, payload };
}

export const huggingfaceAdapter: SourceAdapter = {
  type: "huggingface",
  fetch: async (source: SourceConfig, ctx: FetchContext) => {
    if (!source.url) {
      return err(
        new FetchError("missing_url", `huggingface source '${source.slug}' has no url configured`, {
          slug: source.slug,
        }),
      );
    }
    const endpointCfg = source.config["endpoint"];
    const endpoint = typeof endpointCfg === "string" && endpointCfg.length > 0 ? endpointCfg : "models";

    const fetched = await fetchListing(source.url);
    if (!fetched.ok) {
      ctx.logger.warn("huggingface fetch failed", { slug: source.slug, code: fetched.error.code });
      return fetched;
    }

    const items: RawItem[] = [];
    for (const entry of fetched.value) {
      const item = toRawItem(entry, endpoint);
      if (item) items.push(item);
    }

    ctx.logger.info("huggingface listing parsed", {
      slug: source.slug,
      endpoint,
      entries: fetched.value.length,
      kept: items.length,
    });
    return ok(items);
  },
};
