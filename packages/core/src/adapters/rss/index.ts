import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { SourceAdapter, FetchContext } from "../types";
import type { Json, RawItem } from "../../types/item";
import type { SourceConfig } from "../../types/source";
import { err, ok, type Result } from "../../types/result";
import { FetchError } from "../../errors";
import { contentHash } from "../../util/hash";
import { matchesAiFilter } from "../../util/keywords";

/**
 * RSS 2.0 + Atom adapter.
 *
 * - GETs source.url with a ~15s AbortController timeout.
 * - Parses with fast-xml-parser (no DOM).
 * - Emits one RawItem per entry in the "common payload" convention that
 *   pipeline/normalize.ts understands (title/url/body/body_html/image_url/
 *   author/published_at).
 * - externalId precedence: <guid> (RSS) / <id> (Atom) -> canonical URL ->
 *   contentHash(title+body). Never empty.
 * - source.config.keyword_filter (Product Hunt global feed): when set, keeps
 *   only entries whose title/body matches util/keywords.ts matchesAiFilter().
 * - Expected failures (HTTP >=400, timeout, malformed XML) => err(FetchError),
 *   never throws.
 */

const FETCH_TIMEOUT_MS = 15_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // keep entity processing on (default) so &amp; etc. decode; CDATA text is
  // merged into the node value by default.
});

/** Coerce a parsed XML node to its text content, or null. */
function text(node: unknown): string | null {
  if (typeof node === "string") return node.length > 0 ? node : null;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const t = (node as Record<string, unknown>)["#text"];
    if (typeof t === "string" && t.length > 0) return t;
    if (typeof t === "number") return String(t);
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function attr(node: unknown, name: string): string | null {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** RFC822 / ISO date string -> ISO UTC string, or null when unparseable. */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Crude tag-stripper for keyword matching over HTML bodies. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;

function isImageRef(url: string | null, type: string | null): boolean {
  if (!url) return false;
  if (type) return type.toLowerCase().startsWith("image/");
  return IMAGE_EXT.test(url);
}

/** enclosure / media:content / media:thumbnail -> first plausible image URL. */
function extractImage(entry: Record<string, unknown>): string | null {
  for (const enc of asArray(entry["enclosure"])) {
    const url = attr(enc, "url");
    if (isImageRef(url, attr(enc, "type"))) return url;
  }
  for (const mc of asArray(entry["media:content"])) {
    const url = attr(mc, "url");
    const medium = attr(mc, "medium");
    if (url && (medium === "image" || isImageRef(url, attr(mc, "type")) || (!medium && !attr(mc, "type")))) {
      return url;
    }
  }
  for (const mt of asArray(entry["media:thumbnail"])) {
    const url = attr(mt, "url");
    if (url) return url;
  }
  return null;
}

interface ParsedEntry {
  nativeId: string | null;
  title: string | null;
  url: string | null;
  body: string | null;
  bodyHtml: string | null;
  author: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

function parseRssItem(item: Record<string, unknown>): ParsedEntry {
  const description = text(item["description"]);
  const contentEncoded = text(item["content:encoded"]);
  const bodyHtml =
    contentEncoded ?? (description && looksLikeHtml(description) ? description : null);
  const body = description ? (looksLikeHtml(description) ? stripTags(description) : description) : null;

  return {
    nativeId: text(item["guid"]),
    title: text(item["title"]),
    url: text(item["link"]),
    body,
    bodyHtml,
    author: text(item["dc:creator"]) ?? text(item["author"]),
    publishedAt: toIso(text(item["pubDate"]) ?? text(item["dc:date"])),
    imageUrl: extractImage(item),
  };
}

/** Atom <link>: prefer rel="alternate" (or no rel), fall back to the first href. */
function atomLink(entry: Record<string, unknown>): string | null {
  const links = asArray(entry["link"]);
  for (const l of links) {
    const rel = attr(l, "rel");
    if ((rel === null || rel === "alternate") && attr(l, "href")) return attr(l, "href");
  }
  for (const l of links) {
    if (attr(l, "href")) return attr(l, "href");
    const t = text(l);
    if (t) return t; // some feeds put the URL as text content
  }
  return null;
}

function atomAuthor(entry: Record<string, unknown>): string | null {
  const author = asArray(entry["author"])[0];
  if (author && typeof author === "object") {
    return text((author as Record<string, unknown>)["name"]) ?? text(author);
  }
  return text(author);
}

function parseAtomEntry(entry: Record<string, unknown>): ParsedEntry {
  const content = text(entry["content"]);
  const summary = text(entry["summary"]);
  const contentIsHtml = content !== null && looksLikeHtml(content);

  return {
    nativeId: text(entry["id"]),
    title: text(entry["title"]),
    url: atomLink(entry),
    body: summary ?? (content && !contentIsHtml ? content : content ? stripTags(content) : null),
    bodyHtml: contentIsHtml ? content : null,
    author: atomAuthor(entry),
    publishedAt: toIso(text(entry["published"]) ?? text(entry["updated"])),
    imageUrl: extractImage(entry),
  };
}

function toRawItem(entry: ParsedEntry): RawItem {
  const externalId =
    entry.nativeId ?? entry.url ?? contentHash([entry.title, entry.body ?? entry.bodyHtml]);

  const payload: Json = {
    title: entry.title,
    url: entry.url,
    body: entry.body,
    body_html: entry.bodyHtml,
    image_url: entry.imageUrl,
    author: entry.author,
    published_at: entry.publishedAt,
  };
  return { externalId, payload };
}

function keywordMatchText(entry: ParsedEntry): string {
  return [entry.title, entry.body ?? (entry.bodyHtml ? stripTags(entry.bodyHtml) : null)]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
}

const RETRY_429_DEFAULT_MS = 45_000; // no Retry-After header (Reddit omits it): wait out the bucket
const RETRY_429_MAX_MS = 30_000; // cap for explicit Retry-After values

/**
 * Hosts that rate-limit rapid unauthenticated hits get a minimum gap between
 * requests. Empirically (2026-07) Reddit's unauth .rss budget behaves like a
 * small token bucket refilling ~1 req/30s per IP — 35s pacing keeps a 16-feed
 * sweep reliable. Slow is fine: ingestion is a 12h cron and the workflow has
 * a concurrency guard. Module-level map: pacing persists across sources
 * within one ingest run. Hosts not listed are unaffected (incl. tests).
 */
const HOST_MIN_GAP_MS: Record<string, number> = {
  "www.reddit.com": 35_000,
  "reddit.com": 35_000,
};
const lastFetchAtByHost = new Map<string, number>();

/**
 * Hosts that answered 403 during this run. Reddit blocks some datacenter IP
 * ranges outright ("403 Blocked") and the verdict is per IP, so every later
 * feed on that host would fail the same way after a full pacing wait — a
 * 16-feed sweep would burn ~9 minutes learning nothing. Paced hosts only.
 */
const blockedHosts = new Set<string>();

/** Test hook: clear per-run host state. */
export function resetHostStateForTests(): void {
  lastFetchAtByHost.clear();
  blockedHosts.clear();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function paceForHost(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return; // malformed URL fails later in fetch with a proper FetchError
  }
  const minGap = HOST_MIN_GAP_MS[host];
  if (!minGap) return;
  const last = lastFetchAtByHost.get(host);
  const now = Date.now();
  if (last !== undefined && now - last < minGap) {
    await sleep(minGap - (now - last));
  }
  lastFetchAtByHost.set(host, Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(url: string, attempt = 0): Promise<Result<string, FetchError>> {
  const host = hostOf(url);
  if (host && blockedHosts.has(host)) {
    return err(
      new FetchError(
        "http_status",
        `host ${host} blocked this runner's IP earlier in the run (403); skipped without retry`,
        { url, status: 403 },
      ),
    );
  }
  await paceForHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        // Reddit (and some CDNs) throttle blank/generic UAs, especially from
        // datacenter IPs (GH Actions). Identify honestly, per feed etiquette.
        "user-agent": "ai-news-radar:ingest:v0 (AI news feed reader)",
      },
      redirect: "follow",
    });
    if (res.status === 429 && attempt === 0) {
      // Rate-limited (Reddit does this on back-to-back unauth feed hits).
      // Honor Retry-After when present; retry exactly once.
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? Math.min(Math.max(retryAfter * 1000, 0), RETRY_429_MAX_MS)
        : RETRY_429_DEFAULT_MS;
      clearTimeout(timer);
      await sleep(delay);
      return fetchFeed(url, 1);
    }
    if (!res.ok) {
      if (res.status === 403 && host && HOST_MIN_GAP_MS[host]) blockedHosts.add(host);
      return err(
        new FetchError("http_status", `feed responded ${res.status} ${res.statusText}`, {
          url,
          status: res.status,
        }),
      );
    }
    return ok(await res.text());
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(
        new FetchError("timeout", `feed fetch timed out after ${FETCH_TIMEOUT_MS}ms`, { url }),
      );
    }
    return err(
      new FetchError("network", `feed fetch failed: ${e instanceof Error ? e.message : String(e)}`, {
        url,
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function parseFeedXml(xml: string, url: string): Result<ParsedEntry[], FetchError> {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    return err(
      new FetchError("parse_xml", `malformed feed XML: ${valid.err.msg}`, {
        url,
        line: valid.err.line,
      }),
    );
  }

  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    return err(
      new FetchError("parse_xml", `feed XML failed to parse: ${e instanceof Error ? e.message : String(e)}`, { url }),
    );
  }

  if (!doc || typeof doc !== "object") {
    return err(new FetchError("parse_xml", "feed XML parsed to a non-object", { url }));
  }
  const root = doc as Record<string, unknown>;

  // RSS 2.0: <rss><channel><item>...
  const rss = root["rss"];
  if (rss && typeof rss === "object") {
    const channel = (rss as Record<string, unknown>)["channel"];
    const items = channel && typeof channel === "object"
      ? asArray((channel as Record<string, unknown>)["item"])
      : [];
    return ok(
      items
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .map(parseRssItem),
    );
  }

  // Atom: <feed><entry>...
  const feed = root["feed"];
  if (feed && typeof feed === "object") {
    const entries = asArray((feed as Record<string, unknown>)["entry"]);
    return ok(
      entries
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map(parseAtomEntry),
    );
  }

  return err(
    new FetchError("parse_xml", "document is neither RSS 2.0 (<rss>) nor Atom (<feed>)", { url }),
  );
}

export const rssAdapter: SourceAdapter = {
  type: "rss",
  fetch: async (source: SourceConfig, ctx: FetchContext) => {
    if (!source.url) {
      return err(
        new FetchError("missing_url", `rss source '${source.slug}' has no url configured`, {
          slug: source.slug,
        }),
      );
    }

    const fetched = await fetchFeed(source.url);
    if (!fetched.ok) {
      ctx.logger.warn("rss fetch failed", { slug: source.slug, code: fetched.error.code });
      return fetched;
    }

    const parsed = parseFeedXml(fetched.value, source.url);
    if (!parsed.ok) {
      ctx.logger.warn("rss parse failed", { slug: source.slug, code: parsed.error.code });
      return parsed;
    }

    let entries = parsed.value;
    const total = entries.length;

    // Product Hunt global-feed case: keep only AI-relevant entries.
    if (source.config["keyword_filter"]) {
      entries = entries.filter((e) => matchesAiFilter(keywordMatchText(e)));
    }

    ctx.logger.info("rss feed parsed", {
      slug: source.slug,
      entries: total,
      kept: entries.length,
    });
    return ok(entries.map(toRawItem));
  },
};
