import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCES,
  buildSnapshot,
  createInMemoryRepositories,
  getAdapter,
  runIngest,
  writeSnapshotFile,
  type Logger,
  type RunSummary,
} from "@radar/core";

const logger: Logger = {
  info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
};

/** `<repo>/data/radar.json` unless RADAR_SNAPSHOT overrides it. */
export function resolveSnapshotFile(env: Record<string, string | undefined> = process.env): string {
  if (env.RADAR_SNAPSHOT) return path.resolve(env.RADAR_SNAPSHOT);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/radar.json");
}

/**
 * One stateless run: fetch every enabled source, run the pipeline against
 * in-memory repositories, serialize the result to the snapshot file the web
 * build reads. Nothing persists between runs.
 */
export async function run(args: {
  trigger: "cron" | "manual";
  sources: string[];
  limit: number | undefined;
  dryRun: boolean;
  out: string | undefined;
}): Promise<RunSummary> {
  const { repos, stores } = createInMemoryRepositories([...SOURCES]);

  if (args.dryRun && args.sources.length === 0) args.sources = ["fake-fixture"];

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

  if (args.dryRun) {
    logger.info("dry-run: snapshot not written");
  } else {
    const file = args.out ? path.resolve(args.out) : resolveSnapshotFile();
    const windowDays = Number(process.env.RADAR_WINDOW_DAYS);
    const snapshot = buildSnapshot(
      stores,
      new Date(),
      Number.isFinite(windowDays) && windowDays >= 0 ? { windowDays } : {},
    );
    await writeSnapshotFile(file, snapshot);
    logger.info("snapshot written", {
      file,
      items: snapshot.items.length,
      droppedAsStale: stores.normalizedItems.length - snapshot.items.length,
      clusters: snapshot.clusters.length,
    });
  }
  return summary;
}
