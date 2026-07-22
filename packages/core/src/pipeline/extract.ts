import { ENTITY_KEYWORDS, TOPIC_KEYWORDS } from "../util/keywords";

/** Dictionary/regex tag extraction — MVP deterministic enrichment. */
export function extractTags(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, patterns] of Object.entries(TOPIC_KEYWORDS)) {
    if (patterns.some((re) => re.test(text))) tags.push(tag);
  }
  return tags;
}

/** Dictionary/regex entity extraction (canonical names). */
export function extractEntities(text: string): string[] {
  const entities: string[] = [];
  for (const [entity, patterns] of Object.entries(ENTITY_KEYWORDS)) {
    if (patterns.some((re) => re.test(text))) entities.push(entity);
  }
  return entities;
}
