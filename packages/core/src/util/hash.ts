import { createHash } from "node:crypto";

/** sha256 hex digest of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Canonical content hash for dedup: joins the meaningful parts with a
 * separator that can't appear in normal text, skipping null/undefined.
 * Same content => same hash, regardless of which optional parts are absent.
 */
export function contentHash(parts: Array<string | null | undefined>): string {
  const canonical = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => p.trim().toLowerCase())
    .join("\u0000");
  return sha256Hex(canonical);
}
