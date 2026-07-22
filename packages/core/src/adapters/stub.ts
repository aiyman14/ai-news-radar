import type { SourceAdapter } from "./types";
import type { SourceType } from "../types/source";
import { err } from "../types/result";
import { notImplemented } from "../errors";

/**
 * Typed stub for adapters not yet implemented. Fetch resolves to a
 * `not_implemented` FetchError, which the pipeline records in
 * source_errors — the honest, visible behavior until the real adapter lands.
 */
export function createStubAdapter(type: SourceType): SourceAdapter {
  return {
    type,
    fetch: async () => err(notImplemented(type)),
  };
}
