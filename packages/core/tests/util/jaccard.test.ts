import { describe, expect, it } from "vitest";
import { jaccard } from "../../src/util/jaccard";

describe("jaccard", () => {
  it("is 1 for identical sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("computes |A∩B|/|A∪B|", () => {
    // intersection {b}, union {a,b,c} => 1/3
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("treats two empty sets as identical", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
});
