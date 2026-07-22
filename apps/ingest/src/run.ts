import {
  createInMemoryRepositories,
  createServiceClient,
  createSupabaseRepositories,
  getAdapter,
  parseLlmMaxItems,
  resolveProviders,
  runClusterStage,
  runEmbedStage,
  runEnrichStage,
  runIngest,
  type Logger,
  type Repositories,
  type RunSummary,
} from "@radar/core";

const logger: Logger = {
  info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
};

export async function run(args: {
  trigger: "cron" | "manual";
  sources: string[];
  limit: number | undefined;
  dryRun: boolean;
  recluster: boolean;
  reenrich: boolean;
  reembed: boolean;
}): Promise<RunSummary | null> {
  let repos: Repositories;

  if (args.dryRun) {
    logger.info("dry-run: using in-memory repositories (no DB writes)");
    // Dry-run has no DB to load sources from — it exercises the fake path.
    const { repos: memoryRepos } = createInMemoryRepositories([
      {
        id: "00000000-0000-0000-0000-00000000fa4e",
        slug: "fake-fixture",
        type: "fake",
        name: "Fake fixture source",
        url: null,
        config: {},
        trustScore: 5,
        defaultKindHint: "news",
        enabled: false,
      },
    ]);
    repos = memoryRepos;
    if (args.sources.length === 0) args.sources = ["fake-fixture"];
  } else {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run). " +
          "For local dev, run `supabase start` and copy the values it prints.",
      );
    }
    repos = createSupabaseRepositories(createServiceClient(url, serviceKey));
  }

  // Cluster-stage-only run: no fetching, no run row — reconcile the recent
  // window against story_clusters and report. Errors propagate (exit 1);
  // there is no ingest run to contain them in.
  if (args.recluster) {
    if (args.dryRun) throw new Error("--recluster needs the DB; it cannot run with --dry-run");
    const result = await runClusterStage({ clusters: repos.clusters, logger });
    console.log("\n=== recluster result ===");
    console.log(JSON.stringify(result, null, 2));
    return null;
  }

  // Enrich/embed backfill runs: stage-only, no window (sweep the whole
  // unprocessed backlog), still capped per invocation by
  // LLM_MAX_ITEMS_PER_RUN — repeat the command to work through a backlog.
  // Unconfigured provider → the stage reports skipped:true (see notices).
  if (args.reenrich || args.reembed) {
    if (args.dryRun) {
      throw new Error("--reenrich/--reembed need the DB; they cannot run with --dry-run");
    }
    const providers = resolveProviders(process.env);
    for (const notice of providers.notices) logger.info(notice);
    const maxItems = parseLlmMaxItems(process.env);
    if (args.reenrich) {
      const result = await runEnrichStage(
        { intelligence: repos.intelligence, generation: providers.generation, logger },
        { maxItems, backfill: true },
      );
      console.log("\n=== reenrich result ===");
      console.log(JSON.stringify(result, null, 2));
    }
    if (args.reembed) {
      const result = await runEmbedStage(
        { intelligence: repos.intelligence, embeddings: providers.embeddings, logger },
        { maxItems, backfill: true },
      );
      console.log("\n=== reembed result ===");
      console.log(JSON.stringify(result, null, 2));
    }
    return null;
  }

  const summary = await runIngest(
    { repos, getAdapter, logger, env: process.env },
    {
      trigger: args.trigger,
      sourceSlugs: args.sources.length > 0 ? args.sources : undefined,
      limitPerSource: args.limit,
    },
  );

  console.log("\n=== run summary ===");
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
