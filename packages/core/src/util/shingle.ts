/**
 * Word-level k-shingles for near-duplicate detection (title similarity).
 * Normalization: lowercase, strip punctuation, collapse whitespace.
 */
export function normalizeForShingles(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function wordShingles(text: string, k = 3): Set<string> {
  const words = normalizeForShingles(text);
  const shingles = new Set<string>();
  if (words.length === 0) return shingles;
  if (words.length <= k) {
    shingles.add(words.join(" "));
    return shingles;
  }
  for (let i = 0; i + k <= words.length; i++) {
    shingles.add(words.slice(i, i + k).join(" "));
  }
  return shingles;
}
