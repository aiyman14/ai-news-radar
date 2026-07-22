import { describe, expect, it } from "vitest";
import { contentHash, sha256Hex } from "../../src/util/hash";

describe("sha256Hex", () => {
  it("is deterministic", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("hello")).not.toBe(sha256Hex("hello!"));
  });

  it("produces 64 hex chars", () => {
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("contentHash", () => {
  it("skips null/undefined parts so equal content hashes equal", () => {
    expect(contentHash(["Title", null, "https://a.b"])).toBe(
      contentHash(["Title", undefined, "https://a.b"]),
    );
  });

  it("is case- and whitespace-insensitive per part", () => {
    expect(contentHash(["  Title "])).toBe(contentHash(["title"]));
  });

  it("differs when meaningful content differs", () => {
    expect(contentHash(["Title A"])).not.toBe(contentHash(["Title B"]));
  });
});
