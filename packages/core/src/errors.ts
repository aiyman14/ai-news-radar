/**
 * Typed pipeline errors. One class per phase; each maps 1:1 onto a
 * `source_errors` row (phase, message, detail). See types/result.ts for the
 * convention: these are expected failures carried as Result values —
 * they are recorded and the run continues.
 */

export type IngestPhase =
  | "fetch"
  | "parse"
  | "normalize"
  | "persist"
  // post-persist stage phases:
  | "cluster"
  | "enrich"
  | "embed";

export class IngestError extends Error {
  readonly phase: IngestPhase;
  readonly code: string;
  readonly detail: unknown;

  constructor(phase: IngestPhase, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = new.target.name;
    this.phase = phase;
    this.code = code;
    this.detail = detail;
  }
}

export class FetchError extends IngestError {
  constructor(code: string, message: string, detail?: unknown) {
    super("fetch", code, message, detail);
  }
}

export class ParseError extends IngestError {
  constructor(code: string, message: string, detail?: unknown) {
    super("parse", code, message, detail);
  }
}

export class NormalizeError extends IngestError {
  constructor(code: string, message: string, detail?: unknown) {
    super("normalize", code, message, detail);
  }
}

export class PersistError extends IngestError {
  constructor(code: string, message: string, detail?: unknown) {
    super("persist", code, message, detail);
  }
}

/** Standard error for adapter stubs awaiting implementation. */
export function notImplemented(adapterType: string): FetchError {
  return new FetchError(
    "not_implemented",
    `The '${adapterType}' adapter is not implemented yet (typed stub)`,
  );
}
