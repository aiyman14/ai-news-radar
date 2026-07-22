import type { SourceAdapter, FetchContext } from "../types";
import type { Json, RawItem } from "../../types/item";
import type { SourceConfig } from "../../types/source";
import { err, ok, type Result } from "../../types/result";
import { FetchError } from "../../errors";

/**
 * GitHub releases adapter.
 *
 * - Iterates source.config.repos[] ("owner/repo" strings); GETs
 *   https://api.github.com/repos/{owner}/{repo}/releases?per_page=<config.per_page ?? 5>.
 * - Headers: Accept: application/vnd.github+json + honest User-Agent;
 *   Authorization: Bearer <ctx.env.GITHUB_TOKEN> ONLY when the env var is set
 *   (unauthenticated works at 60 req/hr — fine for 12 repos every 12h).
 * - Skips `draft` releases; keeps `prerelease` ones (flagged in the payload).
 * - externalId = String(release.id). Emits the "common payload" convention
 *   pipeline/normalize.ts understands (title/url/body/author/published_at +
 *   engagement {reactions} when GitHub reports a total_count).
 * - Per-repo failures never kill the source: successes are kept and failed
 *   repos logged via ctx.logger.warn; a single err(FetchError) is returned
 *   ONLY when ALL repos fail (failed repos in the error detail).
 * - 15s AbortController timeout per request; expected failures =>
 *   err(FetchError); NEVER throws.
 */

const FETCH_TIMEOUT_MS = 15_000;
const API_BASE = "https://api.github.com";
const DEFAULT_PER_PAGE = 5;
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

/** config.repos -> validated "owner/repo" strings. */
function readRepos(config: Record<string, Json>): string[] {
  const repos = config["repos"];
  if (!Array.isArray(repos)) return [];
  return repos.filter((r): r is string => typeof r === "string" && r.includes("/"));
}

function readPerPage(config: Record<string, Json>): number {
  const v = config["per_page"];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_PER_PAGE;
}

/** ISO-ish date -> ISO UTC string, or null when absent/unparseable. */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** GET one repo's releases; resolves to the parsed JSON array. */
async function fetchRepoReleases(
  repo: string,
  perPage: number,
  token: string | null,
): Promise<Result<Record<string, unknown>[], FetchError>> {
  const url = `${API_BASE}/repos/${repo}/releases?per_page=${perPage}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
  };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) {
      return err(
        new FetchError("http_status", `github releases for ${repo} responded ${res.status} ${res.statusText}`, {
          repo,
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
        new FetchError("parse_json", `github releases for ${repo} were not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { repo, url }),
      );
    }
    if (!Array.isArray(json)) {
      return err(
        new FetchError("parse_json", `github releases for ${repo} parsed to a non-array`, { repo, url }),
      );
    }
    return ok(json.filter(isRecord));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(
        new FetchError("timeout", `github releases fetch for ${repo} timed out after ${FETCH_TIMEOUT_MS}ms`, { repo, url }),
      );
    }
    return err(
      new FetchError("network", `github releases fetch for ${repo} failed: ${e instanceof Error ? e.message : String(e)}`, { repo, url }),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One release object -> RawItem (common payload). Null when it has no id. */
function toRawItem(repo: string, release: Record<string, unknown>): RawItem | null {
  const id = num(release["id"]);
  if (id === null) return null; // no stable id -> can't dedup; skip defensively

  const name = str(release["name"]) ?? str(release["tag_name"]);
  const author = isRecord(release["author"]) ? str(release["author"]["login"]) : null;
  const reactions = isRecord(release["reactions"]) ? num(release["reactions"]["total_count"]) : null;

  const payload: Json = {
    title: name ? `${repo} ${name}` : repo,
    url: str(release["html_url"]),
    body: str(release["body"]), // markdown, kept as text
    body_html: null,
    image_url: null,
    author,
    published_at: toIso(str(release["published_at"])),
    engagement: reactions !== null ? { reactions } : null,
    // source-native context, kept in the raw payload (normalize ignores it)
    repo,
    tag_name: str(release["tag_name"]),
    prerelease: release["prerelease"] === true,
  };
  return { externalId: String(id), payload };
}

export const githubReleasesAdapter: SourceAdapter = {
  type: "github_releases",
  fetch: async (source: SourceConfig, ctx: FetchContext) => {
    const repos = readRepos(source.config);
    if (repos.length === 0) {
      return err(
        new FetchError("missing_config", `github source '${source.slug}' has no config.repos[]`, {
          slug: source.slug,
        }),
      );
    }
    const perPage = readPerPage(source.config);
    const token = str(ctx.env["GITHUB_TOKEN"]);

    const items: RawItem[] = [];
    const failures: { repo: string; code: string; message: string }[] = [];
    let draftsSkipped = 0;

    for (const repo of repos) {
      const fetched = await fetchRepoReleases(repo, perPage, token);
      if (!fetched.ok) {
        failures.push({ repo, code: fetched.error.code, message: fetched.error.message });
        ctx.logger.warn("github repo fetch failed", {
          slug: source.slug,
          repo,
          code: fetched.error.code,
        });
        continue;
      }
      for (const release of fetched.value) {
        if (release["draft"] === true) {
          draftsSkipped += 1;
          continue;
        }
        const item = toRawItem(repo, release);
        if (item) items.push(item);
      }
    }

    // Only a full wipeout is a source-level failure; partial failure keeps
    // the successes (failed repos were already warned above).
    if (failures.length === repos.length) {
      if (failures.length === 1) {
        // single repo: surface its specific error code directly
        const only = failures[0]!;
        return err(new FetchError(only.code, only.message, { failures }));
      }
      return err(
        new FetchError("all_repos_failed", `github releases: all ${repos.length} repos failed`, {
          failures,
        }),
      );
    }

    ctx.logger.info("github releases fetched", {
      slug: source.slug,
      repos: repos.length,
      failedRepos: failures.length,
      releases: items.length,
      draftsSkipped,
    });
    return ok(items);
  },
};
