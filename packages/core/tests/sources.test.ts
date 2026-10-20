import { describe, expect, it } from "vitest";
import { SOURCES, findSource } from "../src/sources";
import { isSourceType } from "../src/types/source";
import { getAdapter } from "../src/adapters/registry";

describe("SOURCES (the source table in code)", () => {
  it("has 40 enabled sources plus the disabled fake fixture", () => {
    expect(SOURCES.filter((s) => s.enabled)).toHaveLength(40);
    const fake = findSource("fake-fixture");
    expect(fake?.enabled).toBe(false);
    expect(fake?.type).toBe("fake");
  });

  it("uses unique slugs that double as ids", () => {
    const slugs = SOURCES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of SOURCES) expect(s.id).toBe(s.slug);
  });

  it("every enabled source has a valid type with a registered adapter and an https url", () => {
    for (const s of SOURCES.filter((x) => x.enabled)) {
      expect(isSourceType(s.type)).toBe(true);
      expect(getAdapter(s.type), `adapter for ${s.slug}`).toBeDefined();
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.trustScore).toBeGreaterThanOrEqual(1);
      expect(s.trustScore).toBeLessThanOrEqual(10);
    }
  });
});
