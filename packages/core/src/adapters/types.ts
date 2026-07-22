import type { RawItem } from "../types/item";
import type { SourceConfig, SourceType } from "../types/source";
import type { Result } from "../types/result";
import type { FetchError } from "../errors";

/** Minimal structured logger — console in dev/CI, swappable later. */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Everything an adapter may depend on. No hidden globals — testability. */
export interface FetchContext {
  /** UTC "now" for this run — use this, never new Date(), for determinism. */
  now: Date;
  /** Env vars (credentials like GITHUB_TOKEN). Never log values. */
  env: Record<string, string | undefined>;
  logger: Logger;
}

/**
 * THE contract every source implements.
 * Rules for implementers:
 *  - Expected failures (HTTP errors, bad payloads) => err(FetchError),
 *    NEVER throw. The pipeline records them in source_errors and moves on.
 *  - Every RawItem MUST carry a stable externalId (source-native id if
 *    present, else canonical URL / content hash) — it is the dedup key.
 *  - Return the raw source-native payload; normalization happens in the
 *    pipeline, not the adapter.
 */
export interface SourceAdapter {
  readonly type: SourceType;
  fetch(source: SourceConfig, ctx: FetchContext): Promise<Result<RawItem[], FetchError>>;
}
