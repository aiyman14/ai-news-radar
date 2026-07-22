/**
 * Summarizer provider interface: the free rule-based default
 * ships now; an LLM summarizer is a config+env swap later, not a refactor.
 */
export interface Summarizer {
  readonly name: string;
  summarize(input: { title: string; bodyText: string | null }): Promise<string>;
}

const MAX_LEN = 280;

/** Lead paragraph, trimmed and truncated. Deterministic, free. */
export class RuleBasedSummarizer implements Summarizer {
  readonly name = "rule-based";

  async summarize(input: { title: string; bodyText: string | null }): Promise<string> {
    const body = (input.bodyText ?? "").trim();
    if (!body) return input.title;
    const firstParagraph = body.split(/\n\s*\n/, 1)[0] ?? body;
    if (firstParagraph.length <= MAX_LEN) return firstParagraph;
    return `${firstParagraph.slice(0, MAX_LEN - 1).trimEnd()}…`;
  }
}
