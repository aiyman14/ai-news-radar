/**
 * Ingestion CLI — the GitHub Actions entrypoint (and local dev runner).
 *
 * Flags:
 *   --trigger cron|manual   run record trigger (default manual)
 *   --source a,b,c          limit to specific slugs (also runs disabled
 *                           sources, e.g. fake-fixture)
 *   --limit N               cap items per source
 *   --dry-run               in-memory repos; nothing written to the DB
 *   --recluster             run ONLY the post-persist cluster stage over the
 *                           recent window (no fetching; requires the DB)
 *   --reenrich              run ONLY the LLM enrich stage in BACKFILL mode:
 *                           sweep ALL unenriched items (no window), capped
 *                           by LLM_MAX_ITEMS_PER_RUN per invocation
 *   --reembed               run ONLY the embed stage in backfill mode
 *                           (same contract as --reenrich)
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (not needed for --dry-run),
 *      INGEST_LIMIT_SOURCES as a fallback for --source,
 *      LLM_PROVIDER / EMBEDDINGS_PROVIDER (+keys) for enrich/embed stages
 *      — unset means those stages log a notice and skip.
 */
import { run } from "./run";

function parseArgs(argv: string[]): {
  trigger: "cron" | "manual";
  sources: string[];
  limit: number | undefined;
  dryRun: boolean;
  recluster: boolean;
  reenrich: boolean;
  reembed: boolean;
} {
  let trigger: "cron" | "manual" = "manual";
  let sources: string[] = [];
  let limit: number | undefined;
  let dryRun = false;
  let recluster = false;
  let reenrich = false;
  let reembed = false;

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
      case "--dry-run":
        dryRun = true;
        break;
      case "--recluster":
        recluster = true;
        break;
      case "--reenrich":
        reenrich = true;
        break;
      case "--reembed":
        reembed = true;
        break;
      case "--": // pnpm forwards the separator literally — ignore it
        break;
      default:
        throw new Error(`unknown flag '${arg ?? ""}'`);
    }
  }

  // Env fallback for source scoping (plan §10 dev knob).
  if (sources.length === 0 && process.env.INGEST_LIMIT_SOURCES) {
    sources = process.env.INGEST_LIMIT_SOURCES.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return { trigger, sources, limit, dryRun, recluster, reenrich, reembed };
}

const args = parseArgs(process.argv.slice(2));

run(args)
  .then((summary) => {
    // 'partial' is an operational state, not a CI failure (plan §10).
    // Stage-only runs (--recluster etc.) return no RunSummary;
    // reaching here means success.
    process.exitCode = summary !== null && summary.status === "failed" ? 1 : 0;
  })
  .catch((e) => {
    console.error("ingest crashed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
