/**
 * Kind + content-category metadata.
 * Class strings are literal (Tailwind JIT needs full class names in source);
 * they reference token-mapped colors only (tailwind.config.ts → globals.css).
 */

export const KINDS = [
  "news",
  "launch",
  "tool",
  "tip",
  "discussion",
  "research",
  "opinion",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  news: "News",
  launch: "Launch",
  tool: "Tool",
  tip: "Tip",
  discussion: "Discussion",
  research: "Research",
  opinion: "Opinion",
};

/** Colored chip classes per kind (text + translucent bg + border). */
const KIND_CHIP: Record<Kind, string> = {
  news: "text-kind-news bg-kind-news/10 border-kind-news/30",
  launch: "text-kind-launch bg-kind-launch/10 border-kind-launch/30",
  tool: "text-kind-tool bg-kind-tool/10 border-kind-tool/30",
  tip: "text-kind-tip bg-kind-tip/10 border-kind-tip/30",
  discussion: "text-kind-discussion bg-kind-discussion/10 border-kind-discussion/30",
  research: "text-kind-research bg-kind-research/10 border-kind-research/30",
  opinion: "text-kind-opinion bg-kind-opinion/10 border-kind-opinion/30",
};

const FALLBACK_CHIP = "text-muted bg-surface-2 border-border";

export function kindChipClass(kind: string): string {
  return KIND_CHIP[kind as Kind] ?? FALLBACK_CHIP;
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as Kind] ?? kind;
}
