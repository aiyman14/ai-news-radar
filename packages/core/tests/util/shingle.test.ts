import { describe, expect, it } from "vitest";
import { wordShingles } from "../../src/util/shingle";

describe("wordShingles", () => {
  it("builds k-shingles over words", () => {
    const s = wordShingles("a b c d", 3);
    expect(s).toEqual(new Set(["a b c", "b c d"]));
  });

  it("normalizes case and punctuation", () => {
    expect(wordShingles("Claude 5: Released!", 2)).toEqual(wordShingles("claude 5 released", 2));
  });

  it("returns the whole text as one shingle when shorter than k", () => {
    expect(wordShingles("too short", 3)).toEqual(new Set(["too short"]));
  });

  it("returns empty set for empty text", () => {
    expect(wordShingles("", 3).size).toBe(0);
  });
});
