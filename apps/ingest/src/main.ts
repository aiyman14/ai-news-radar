/**
 * Ingestion CLI — the GitHub Actions entrypoint (and local dev runner).
 *
 * Flags:
 *   --trigger cron|manual   recorded on the run row (default manual)
 *   --source a,b,c          limit to specific slugs (also runs disabled
 *                           sources, e.g. fake-fixture)
 *   --limit N               cap items per source
 *   --out FILE              snapshot path (default <repo>/data/radar.json)
 *   --dry-run               run the fake fixture only; write nothing
 *
 * Env: RADAR_SNAPSHOT as the env twin of --out,
 *      RADAR_WINDOW_DAYS freshness window for the snapshot (default 14; 0 = all),
 *      INGEST_LIMIT_SOURCES as a fallback for --source,
 *      GITHUB_TOKEN (optional) raises the releases adapter's rate limit,
 *      LLM_PROVIDER / EMBEDDINGS_PROVIDER (+keys) for enrich/embed stages
 *      — unset means those stages log a notice and skip.
 */
import { run } from "./run";

function parseArgs(argv: string[]): {
  trigger: "cron" | "manual";
  sources: string[];
  limit: number | undefined;
  dryRun: boolean;
  out: string | undefined;
} {
  let trigger: "cron" | "manual" = "manual";
  let sources: string[] = [];
  let limit: number | undefined;
  let dryRun = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--trigger": {
        const v = argv[++i];
        if (v === "cron" || v === "manual") trigger = v;
        else throw new Error(`--trigger must be cron|manual, got '${v ?? ""}'`);
        break;
      }
      case "--source": {
        const v = argv[++i];
        if (!v) throw new Error("--source requires a comma-separated slug list");
        sources = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      }
      case "--limit": {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new Error("--limit must be a positive number");
        limit = v;
        break;
      }
      case "--out": {
        const v = argv[++i];
        if (!v) throw new Error("--out requires a file path");
        out = v;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--": // pnpm forwards the separator literally — ignore it
        break;
      default:
        throw new Error(`unknown flag '${arg ?? ""}'`);
    }
  }

  // Env fallback for source scoping.
  if (sources.length === 0 && process.env.INGEST_LIMIT_SOURCES) {
    sources = process.env.INGEST_LIMIT_SOURCES.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return { trigger, sources, limit, dryRun, out };
}

run(parseArgs(process.argv.slice(2)))
  .then((summary) => {
    // 'partial' is an operational state, not a CI failure: some sources
    // failed, the rest were ingested and the snapshot was written.
    process.exitCode = summary.status === "failed" ? 1 : 0;
  })
  .catch((e) => {
    console.error("ingest crashed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
