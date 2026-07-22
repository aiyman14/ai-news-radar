import type { Kind } from "../types/item";
import type { SourceConfig } from "../types/source";
import { KIND_RULES } from "../util/keywords";

/**
 * Deterministic kind classifier (schema addendum).
 * Prior = source.default_kind_hint; keyword rules refine it.
 * Confidence: rule + agreeing prior 0.9 · rule alone 0.7 ·
 * prior alone 0.4 · nothing => 'news' at 0.2.
 * LLM classification is a later provider swap.
 */
export function classifyKind(
  input: { title: string; bodyText: string | null },
  source: Pick<SourceConfig, "defaultKindHint">,
): { kind: Kind; confidence: number } {
  const text = `${input.title} ${input.bodyText ?? ""}`;
  const prior = source.defaultKindHint;

  for (const rule of KIND_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return { kind: rule.kind, confidence: prior === rule.kind ? 0.9 : 0.7 };
    }
  }
  if (prior) return { kind: prior, confidence: 0.4 };
  return { kind: "news", confidence: 0.2 };
}
