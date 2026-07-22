import { wordShingles } from "../util/shingle";
import { jaccard } from "../util/jaccard";
import type { ClusterableItem, ClusterPatch } from "../types/item";
import type { ClusterStageResult } from "../types/result";
import type { ClustersRepo } from "../db/repositories/types";
import type { Logger } from "../adapters/types";

/**
 * Story clustering — the first POST-PERSIST pipeline stage, and
 * the pattern later post-persist stages (rescoring, digests) copy:
 *
 *  1. The stage is a standalone `run<Stage>Stage(deps, opts)` function that
 *     takes only the repos it needs + logger + injectable clock. It never
 *     touches raw_items or the ingest loop — it reads what persist wrote.
 *  2. All *logic* is in pure, deterministic functions (groupWindowItems,
 *     computeClusterPatch) that take plain data; the async stage body only
 *     sequences repo calls around them. Test the pure parts exhaustively,
 *     the stage body against the in-memory repos.
 *  3. `runIngest` calls the stage post-persist inside a try/catch: a stage
 *     failure is recorded source_errors-style (runId set, sourceId null)
 *     and the run CONTINUES — a post-persist bug must never lose ingested
 *     items or crash the run.
 *  4. Derived state is always recomputed in full from source-of-truth rows
 *     (never incremented), so re-running converges (idempotent) instead of
 *     drifting.
 *
 * Algorithm: title word-shingles + Jaccard similarity,
 * single-link grouping over a recent window.
 *  - Window: items with fetched_at in the last CLUSTER_WINDOW_HOURS. Never
 *    O(n²) over the whole table — O(w²) over the window only. Items outside
 *    the window keep whatever cluster_id they already have.
 *  - Two in-window items belong to the same story when
 *    titleSimilarity >= threshold, transitively (union-find). Items that
 *    already share a cluster_id are kept together regardless of similarity
 *    (clusters never split — that would thrash as wording drifts out the
 *    window).
 *  - Singletons stay cluster_id = null: a cluster row exists only at >= 2
 *    members. An already-assigned item whose partners fell out of the
 *    window is NOT unassigned.
 *  - If a new item bridges two existing clusters, they merge: the cluster
 *    with the smallest id survives (arbitrary but deterministic — every
 *    displayed field is recomputed from membership anyway), all members
 *    (including out-of-window ones) are reassigned, losers are deleted.
 *  - Upkeep on every touched cluster is recomputed from FULL membership:
 *    representative = highest-scored member, title from representative,
 *    summary = deterministic trim of representative body (no LLM),
 *    tags/entities = sorted union, score = max member score,
 *    first/last_seen = min/max of (published_at ?? fetched_at).
 */

/**
 * Similarity threshold for "same story", calibrated 2026-07-07 against the
 * 598-item local corpus (483 reddit + github releases + HF trending).
 * Observed pair distribution (146 pairs at sim >= 0.2):
 *  - >= 0.4: every pair is a true same-story match — cross-subreddit
 *    duplicates sit at 1.0, a repost-with-suffix at 0.73, same-repo
 *    release families (anthropic-sdk v0.113–116, llama_index v0.14.x) at
 *    0.43–0.71, same-model-family variants (Ornith 9B/35B/GGUF) at 0.5.
 *  - 0.33 band: same-repo version runs only (llama.cpp b9888–b9893, vllm
 *    v0.21–24) — also true collapses, but no margin below them.
 *  - first false positives at <= 0.29: org-name-only overlap
 *    (build-small-hackathon/* spaces, langchain-* subpackages).
 * 0.4 keeps every verified true positive (0.35 and 0.4 produce identical
 * clusterings on this corpus) with ~1.5x margin above the false-positive
 * floor; the ticket's ~0.5 default would split same-repo release families
 * into singleton spam. 3-word shingles make word *order* matter enough
 * that mere topic overlap doesn't match.
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.4;
export const CLUSTER_SHINGLE_SIZE = 3;
/** Comparison window in hours (by fetched_at) — plan's 72h default. */
export const CLUSTER_WINDOW_HOURS = 72;
/** Cluster summary = representative body trimmed to this many chars. */
export const CLUSTER_SUMMARY_MAX_CHARS = 280;

/** Title similarity in [0,1] — the primitive the grouping builds on. */
export function titleSimilarity(a: string, b: string, k = CLUSTER_SHINGLE_SIZE): number {
  return jaccard(wordShingles(a, k), wordShingles(b, k));
}

/**
 * SEMANTIC ASSIST.
 * When both items carry embeddings, the pair similarity becomes
 * `max(jaccard, mappedCosine)` — an embedding match can join items whose
 * titles are worded too differently for shingles, but can never split
 * what titles already join.
 *
 * mappedCosine linearly maps cosine [FLOOR..1] onto [0..1] so it lands on
 * the same scale as the Jaccard threshold: cosine at the floor → 0 (never
 * merges), cosine 1.0 → 1.0. The floor below is a PLACEHOLDER — real
 * embedding cosine distributions are provider-specific and MUST be
 * calibrated against live embeddings the way the Jaccard threshold above
 * was (documented follow-up in the ticket; that's why the flag defaults
 * off — fake-provider vectors are hash noise and carry no semantics).
 */
export const SEMANTIC_COSINE_FLOOR = 0.6; // UNCALIBRATED — see note above

/** Cosine similarity of two equal-length vectors (0 when degenerate). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Map a cosine onto the Jaccard-threshold scale (see SEMANTIC ASSIST). */
export function mapCosineToSimilarity(cosine: number, floor = SEMANTIC_COSINE_FLOOR): number {
  return Math.max(0, (cosine - floor) / (1 - floor));
}

export interface GroupingOptions {
  threshold?: number;
  shingleSize?: number;
  /** Blend embedding cosine into pair similarity (CLUSTER_SEMANTIC=1). */
  semantic?: boolean;
}

/**
 * Single-link grouping of the window: union items whose title similarity
 * meets the threshold, plus items already sharing a cluster_id. Pure and
 * deterministic: components (and members within them) come back sorted by
 * item id. Titles that normalize to zero shingles (e.g. emoji-only) carry
 * no signal and are never merged by similarity.
 */
export function groupWindowItems(
  items: ClusterableItem[],
  opts: GroupingOptions = {},
): ClusterableItem[][] {
  const threshold = opts.threshold ?? CLUSTER_SIMILARITY_THRESHOLD;
  const k = opts.shingleSize ?? CLUSTER_SHINGLE_SIZE;

  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
  const shingles = sorted.map((it) => wordShingles(it.title, k));

  // Union-find with path compression.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Existing co-membership binds (clusters never split).
  const firstIndexByCluster = new Map<string, number>();
  sorted.forEach((it, i) => {
    if (it.clusterId === null) return;
    const first = firstIndexByCluster.get(it.clusterId);
    if (first === undefined) firstIndexByCluster.set(it.clusterId, i);
    else union(first, i);
  });

  // Pairwise similarity within the window. Zero-shingle titles (e.g.
  // emoji-only) carry no lexical signal and never merge on Jaccard; with
  // the semantic assist on, embeddings can still speak for them.
  const semantic = opts.semantic ?? false;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (find(i) === find(j)) continue; // already together
      let sim = 0;
      if (shingles[i]!.size > 0 && shingles[j]!.size > 0) {
        sim = jaccard(shingles[i]!, shingles[j]!);
      }
      if (semantic && sim < threshold) {
        const ea = sorted[i]!.embedding;
        const eb = sorted[j]!.embedding;
        if (ea && eb) sim = Math.max(sim, mapCosineToSimilarity(cosineSimilarity(ea, eb)));
      }
      if (sim >= threshold) union(i, j);
    }
  }

  const byRoot = new Map<number, ClusterableItem[]>();
  sorted.forEach((it, i) => {
    const root = find(i);
    const group = byRoot.get(root);
    if (group) group.push(it);
    else byRoot.set(root, [it]);
  });
  // Map preserves insertion order = ascending root index = ascending min id.
  return [...byRoot.values()];
}

/** Deterministic trim of a body to a summary (word boundary + ellipsis). */
export function summarizeBody(body: string | null): string | null {
  if (body === null) return null;
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= CLUSTER_SUMMARY_MAX_CHARS) return collapsed;
  const slice = collapsed.slice(0, CLUSTER_SUMMARY_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/** An item's timeline position: published_at when known, else fetched_at. */
function seenAt(item: ClusterableItem): Date {
  return item.publishedAt ?? item.fetchedAt;
}

/**
 * Recompute a cluster's upkeep fields from its FULL membership (pure).
 * Representative = highest score, ties broken by earlier seenAt then
 * smaller id — fully deterministic.
 */
export function computeClusterPatch(members: ClusterableItem[]): ClusterPatch {
  if (members.length === 0) throw new Error("computeClusterPatch requires >= 1 member");

  const rep = [...members].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const at = seenAt(a).getTime();
    const bt = seenAt(b).getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : 1;
  })[0]!;

  const tagUnion = new Set<string>();
  const entityUnion = new Set<string>();
  let firstSeen = seenAt(members[0]!);
  let lastSeen = firstSeen;
  let maxScore = members[0]!.score;
  for (const m of members) {
    for (const t of m.tags) tagUnion.add(t);
    for (const e of m.entities) entityUnion.add(e);
    const at = seenAt(m);
    if (at < firstSeen) firstSeen = at;
    if (at > lastSeen) lastSeen = at;
    if (m.score > maxScore) maxScore = m.score;
  }

  return {
    representativeId: rep.id,
    title: rep.title,
    summary: summarizeBody(rep.bodyText),
    tags: [...tagUnion].sort(),
    entities: [...entityUnion].sort(),
    itemCount: members.length,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    score: maxScore,
  };
}

export interface ClusterStageDeps {
  clusters: ClustersRepo;
  logger: Logger;
  /** Injectable clock (determinism) — defaults to wall clock. */
  now?: () => Date;
}

export interface ClusterStageOptions extends GroupingOptions {
  windowHours?: number;
}

/**
 * The post-persist clustering stage. Reads the recent window, groups it,
 * and reconciles story_clusters + normalized_items.cluster_id with the
 * grouping. Safe to re-run at any time: unchanged inputs are a no-op
 * (stable counts, zero writes).
 *
 * Throws on repo failure — the CALLER contains it (see runIngest).
 */
export async function runClusterStage(
  deps: ClusterStageDeps,
  opts: ClusterStageOptions = {},
): Promise<ClusterStageResult> {
  const { clusters, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const windowHours = opts.windowHours ?? CLUSTER_WINDOW_HOURS;
  const since = new Date(now().getTime() - windowHours * 60 * 60 * 1000);

  const windowItems = await clusters.listClusterableItems(since, {
    withEmbeddings: opts.semantic ?? false,
  });
  const components = groupWindowItems(windowItems, opts);

  const result: ClusterStageResult = {
    itemsConsidered: windowItems.length,
    itemsAssigned: 0,
    clustersCreated: 0,
    clustersUpdated: 0,
    clustersMerged: 0,
  };

  // Decide which components need writes, then batch-fetch full membership
  // of every pre-existing cluster they touch (upkeep must count
  // out-of-window members too).
  const actionable: Array<{ component: ClusterableItem[]; existingIds: string[] }> = [];
  for (const component of components) {
    const existingIds = [
      ...new Set(component.map((m) => m.clusterId).filter((id): id is string => id !== null)),
    ].sort();

    // Singleton rule: no cluster below 2 members. (A lone item that IS
    // assigned keeps its cluster — its partners are just out of window —
    // and nothing changed, so nothing is written.)
    if (existingIds.length === 0 && component.length < 2) continue;
    if (existingIds.length === 1 && component.every((m) => m.clusterId === existingIds[0])) {
      continue; // fully converged already — idempotent no-op
    }
    actionable.push({ component, existingIds });
  }

  const touchedClusterIds = [...new Set(actionable.flatMap((a) => a.existingIds))].sort();
  const outsideMembers =
    touchedClusterIds.length > 0 ? await clusters.listItemsByClusterIds(touchedClusterIds) : [];
  const membersByCluster = new Map<string, ClusterableItem[]>();
  for (const m of outsideMembers) {
    if (m.clusterId === null) continue;
    const list = membersByCluster.get(m.clusterId);
    if (list) list.push(m);
    else membersByCluster.set(m.clusterId, [m]);
  }

  for (const { component, existingIds } of actionable) {
    // Full membership = window component ∪ all members of touched clusters.
    const byId = new Map<string, ClusterableItem>();
    for (const id of existingIds) {
      for (const m of membersByCluster.get(id) ?? []) byId.set(m.id, m);
    }
    for (const m of component) byId.set(m.id, m);
    const fullMembers = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const patch = computeClusterPatch(fullMembers);

    if (existingIds.length === 0) {
      const clusterId = await clusters.createCluster(patch);
      await clusters.assignItems(
        clusterId,
        fullMembers.map((m) => m.id),
      );
      result.clustersCreated += 1;
      result.itemsAssigned += fullMembers.length;
    } else {
      // Smallest id survives; every displayed field is recomputed anyway.
      const target = existingIds[0]!;
      const losers = existingIds.slice(1);
      const toAssign = fullMembers.filter((m) => m.clusterId !== target).map((m) => m.id);
      await clusters.updateCluster(target, patch);
      if (toAssign.length > 0) await clusters.assignItems(target, toAssign);
      // Reassign BEFORE delete: the FK would null-out un-moved members.
      if (losers.length > 0) await clusters.deleteClusters(losers);
      result.clustersUpdated += 1;
      result.clustersMerged += losers.length;
      result.itemsAssigned += toAssign.length;
    }
  }

  logger.info("cluster stage done", { ...result });
  return result;
}
