import type { Logger, SourceAdapter } from "../adapters/types";
import type { SourceType } from "../types/source";
import type {
  ClusterStageResult,
  EmbedStageResult,
  EnrichStageResult,
  RunStatus,
  RunSummary,
  RunTrigger,
  SourceIngestResult,
} from "../types/result";
import type { Repositories } from "../db/repositories/types";
import type { EmbeddingsProvider, GenerationProvider } from "../providers/llm";
import { resolveProviders } from "../providers/index";
import { IngestError, PersistError } from "../errors";
import { normalizeRawItem } from "./normalize";
import { classifyKind } from "./classify";
import { extractEntities, extractTags } from "./extract";
import { partitionNew, type DedupInput } from "./dedup";
import { scoreItem } from "./score";
import { runEnrichStage, DEFAULT_LLM_MAX_ITEMS_PER_RUN } from "./enrich";
import { runEmbedStage } from "./embed";
import { runClusterStage } from "./cluster";

export interface IngestDeps {
  repos: Repositories;
  getAdapter: (type: SourceType) => SourceAdapter | undefined;
  logger: Logger;
  env: Record<string, string | undefined>;
  /**
   * LLM providers for the enrich/embed stages. Omitted → resolved from env
   * (resolveProviders); tests inject fakes/stubs directly. null slots make
   * the corresponding stage skip gracefully.
   */
  providers?: {
    generation: GenerationProvider | null;
    embeddings: EmbeddingsProvider | null;
  };
  /** Injectable clock for tests. */
  now?: () => Date;
}

/** Parse the LLM_MAX_ITEMS_PER_RUN env cap (default 400). */
export function parseLlmMaxItems(env: Record<string, string | undefined>): number {
  const raw = Number(env.LLM_MAX_ITEMS_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LLM_MAX_ITEMS_PER_RUN;
}

export interface IngestOptions {
  trigger: RunTrigger;
  /**
   * Explicit slugs to run (includes disabled sources — that's how the
   * fake-fixture e2e runs). Empty/undefined = all enabled sources.
   */
  sourceSlugs?: string[];
  /** Cap items per source (dev knob). */
  limitPerSource?: number;
}

/**
 * The ingestion orchestrator:
 *   fetch -> normalize -> classify -> enrich -> score -> dedup -> persist
 * then the post-persist stages (enrich, embed, cluster).
 *
 * Failure policy (the pattern every later stage keeps):
 *  - per-source failures are recorded in source_errors and the run CONTINUES;
 *  - the run row always gets finished ('partial'/'failed' rather than crash);
 *  - only infrastructure failures (can't create the run row) throw.
 */
export async function runIngest(deps: IngestDeps, opts: IngestOptions): Promise<RunSummary> {
  const { repos, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();

  const sources =
    opts.sourceSlugs && opts.sourceSlugs.length > 0
      ? await repos.sources.getBySlugs(opts.sourceSlugs)
      : await repos.sources.listEnabled();

  const runId = await repos.runs.start(opts.trigger);
  logger.info("ingestion run started", { runId, trigger: opts.trigger, sources: sources.length });

  const results: SourceIngestResult[] = [];

  for (const source of sources) {
    const result: SourceIngestResult = {
      sourceSlug: source.slug,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      failed: 0,
      errors: [],
    };
    results.push(result);

    const recordError = async (e: IngestError) => {
      result.failed += 1;
      result.errors.push(`[${e.phase}/${e.code}] ${e.message}`);
      await repos.errors.record({
        runId,
        sourceId: source.id,
        phase: e.phase,
        message: e.message,
        detail: { code: e.code, detail: e.detail ?? null },
      });
    };

    try {
      const adapter = deps.getAdapter(source.type);
      if (!adapter) {
        await recordError(
          new IngestError("fetch", "no_adapter", `no adapter registered for type '${source.type}'`),
        );
        continue;
      }

      const fetchedAt = now();
      const fetchResult = await adapter.fetch(source, {
        now: fetchedAt,
        env: deps.env,
        logger,
      });
      if (!fetchResult.ok) {
        await recordError(fetchResult.error);
        continue;
      }

      let rawItems = fetchResult.value;
      if (opts.limitPerSource && opts.limitPerSource > 0) {
        rawItems = rawItems.slice(0, opts.limitPerSource);
      }
      result.fetched = rawItems.length;

      // normalize -> classify -> enrich -> score (per item; failures recorded)
      const candidates: DedupInput[] = [];
      for (const raw of rawItems) {
        const normalized = normalizeRawItem(source, raw);
        if (!normalized.ok) {
          await recordError(normalized.error);
          continue;
        }
        const draft = normalized.value;
        const text = `${draft.title} ${draft.bodyText ?? ""}`;
        const { kind, confidence } = classifyKind(draft, source);
        draft.kind = kind;
        draft.kindConfidence = confidence;
        draft.tags = extractTags(text);
        draft.entities = extractEntities(text);
        draft.score = scoreItem(draft, source, fetchedAt);
        candidates.push({ raw, draft });
      }

      // dedup against DB + within batch
      const existing = await repos.items.findExistingExternalIds(
        source.id,
        candidates.map((c) => c.raw.externalId),
      );
      const { fresh, duplicates } = partitionNew(candidates, existing);
      result.duplicates = duplicates.length;

      // persist
      if (fresh.length > 0) {
        try {
          const inserted = await repos.items.insertItems({
            runId,
            source,
            items: fresh,
            fetchedAt,
          });
          result.inserted = inserted;
        } catch (e) {
          await recordError(
            new PersistError("insert_failed", e instanceof Error ? e.message : String(e)),
          );
        }
      }
      logger.info("source done", {
        slug: source.slug,
        fetched: result.fetched,
        inserted: result.inserted,
        duplicates: result.duplicates,
        failed: result.failed,
      });
    } catch (e) {
      // Unexpected exception: contain it to this source, keep the run alive.
      await recordError(
        new IngestError("fetch", "unexpected", e instanceof Error ? e.message : String(e)),
      );
    }
  }

  // ---- Post-persist stages ---------------------------------------------
  // Order: enrich → embed → cluster (embed wants llm_summary; cluster's
  // semantic assist wants embeddings).
  // Same containment contract as sources: a stage failure is recorded
  // (source_errors, sourceId null) and the run continues — post-persist
  // work must never lose ingested items. Each stage gets its own try/catch:
  // an enrich-stage bug must not block clustering, etc. An UNCONFIGURED
  // provider is not a failure — the stage returns skipped:true (notice
  // logged once here, from resolveProviders).
  const providers =
    deps.providers ??
    (() => {
      const resolved = resolveProviders(deps.env);
      for (const notice of resolved.notices) logger.info(notice);
      return resolved;
    })();
  const llmMaxItems = parseLlmMaxItems(deps.env);

  let enrichResult: EnrichStageResult | undefined;
  try {
    enrichResult = await runEnrichStage(
      { intelligence: repos.intelligence, generation: providers.generation, logger, now },
      { maxItems: llmMaxItems },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("enrich stage failed (contained)", { message });
    await repos.errors.record({
      runId,
      sourceId: null,
      phase: "enrich",
      message: `[enrich/stage_failed] ${message}`,
      detail: { stage: "enrich" },
    });
  }

  let embedResult: EmbedStageResult | undefined;
  try {
    embedResult = await runEmbedStage(
      { intelligence: repos.intelligence, embeddings: providers.embeddings, logger, now },
      { maxItems: llmMaxItems },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("embed stage failed (contained)", { message });
    await repos.errors.record({
      runId,
      sourceId: null,
      phase: "embed",
      message: `[embed/stage_failed] ${message}`,
      detail: { stage: "embed" },
    });
  }

  let clusterResult: ClusterStageResult | undefined;
  try {
    clusterResult = await runClusterStage(
      { clusters: repos.clusters, logger, now },
      { semantic: deps.env.CLUSTER_SEMANTIC === "1" },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("cluster stage failed (contained)", { message });
    await repos.errors.record({
      runId,
      sourceId: null,
      phase: "cluster",
      message: `[cluster/stage_failed] ${message}`,
      detail: { stage: "cluster" },
    });
  }

  // Totals derived from per-source results AFTER the loop — early `continue`s
  // must never skip accounting.
  const itemsFetched = results.reduce((n, r) => n + r.fetched, 0);
  const itemsNew = results.reduce((n, r) => n + r.inserted, 0);
  const itemsFailed = results.reduce((n, r) => n + r.failed, 0);

  const sourcesWithFailures = results.filter((r) => r.failed > 0).length;
  const status: RunStatus =
    sourcesWithFailures === 0
      ? "success"
      : sourcesWithFailures === results.length && itemsNew === 0
        ? "failed"
        : "partial";

  const finishedAt = now();
  await repos.runs.finish(runId, {
    status,
    itemsFetched,
    itemsNew,
    itemsFailed,
    notes:
      [
        sourcesWithFailures > 0
          ? `${sourcesWithFailures}/${results.length} sources had failures`
          : null,
        enrichResult === undefined ? "enrich stage failed" : null,
        embedResult === undefined ? "embed stage failed" : null,
        clusterResult === undefined ? "cluster stage failed" : null,
      ]
        .filter((n): n is string => n !== null)
        .join("; ") || undefined,
  });
  logger.info("ingestion run finished", { runId, status, itemsFetched, itemsNew, itemsFailed });

  return {
    runId,
    trigger: opts.trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status,
    itemsFetched,
    itemsNew,
    itemsFailed,
    sources: results,
    enrich: enrichResult,
    embed: embedResult,
    clusters: clusterResult,
  };
}
