import type { NormalizedDraft } from "../types/item";
import type { SourceConfig } from "../types/source";

/**
 * Deterministic ranking heuristic — PLACEHOLDER shape, real tuning is a
 * later task (plan Phase 5). Kept simple and monotonic:
 *   score = source trust (0-10) + log-scaled engagement + freshness bonus.
 */
export function scoreItem(
  draft: Pick<NormalizedDraft, "engagement" | "publishedAt">,
  source: Pick<SourceConfig, "trustScore">,
  now: Date,
): number {
  let score = source.trustScore;

  const raw = draft.engagement?.["score"];
  if (typeof raw === "number" && raw > 0) {
    score += Math.log10(1 + raw) * 2; // 100 upvotes ≈ +4
  }

  if (draft.publishedAt) {
    const ageHours = (now.getTime() - draft.publishedAt.getTime()) / 3_600_000;
    if (ageHours >= 0 && ageHours < 24) score += 2;
    else if (ageHours >= 24 && ageHours < 72) score += 1;
  }

  return Math.round(score * 100) / 100;
}
