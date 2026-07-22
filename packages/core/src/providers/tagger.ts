import { extractEntities, extractTags } from "../pipeline/extract";

/**
 * Tagger provider interface: dictionary default now,
 * NER/LLM tagger later behind the same interface.
 */
export interface Tagger {
  readonly name: string;
  tag(input: { title: string; bodyText: string | null }): Promise<{
    tags: string[];
    entities: string[];
  }>;
}

export class DictionaryTagger implements Tagger {
  readonly name = "dictionary";

  async tag(input: { title: string; bodyText: string | null }) {
    const text = `${input.title} ${input.bodyText ?? ""}`;
    return { tags: extractTags(text), entities: extractEntities(text) };
  }
}
