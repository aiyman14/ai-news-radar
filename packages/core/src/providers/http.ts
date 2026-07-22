import type { Result } from "../types/result";
import { err, ok } from "../types/result";
import { ProviderError } from "./llm";

/**
 * Shared HTTP plumbing for the real providers (anthropic/openai/voyage):
 * plain fetch, JSON in/out, a deadline, and retry-once on transient
 * failures (429 / 5xx / network / timeout). No SDK dependencies.
 *
 * Security: headers carry API keys — they are NEVER logged, and
 * ProviderError messages only ever include status codes and body-free
 * summaries (response bodies could echo the prompt, keys stay in headers).
 */

export const PROVIDER_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 500;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function attempt(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Result<unknown, ProviderError> & { retryable?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ...err(
          new ProviderError(
            provider,
            aborted ? "timeout" : "network",
            aborted
              ? `request timed out after ${timeoutMs}ms`
              : `network failure: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ),
        retryable: true,
      };
    }

    if (!response.ok) {
      return {
        ...err(
          new ProviderError(
            provider,
            "http_error",
            `HTTP ${response.status} ${response.statusText}`,
            response.status,
          ),
        ),
        retryable: isRetryableStatus(response.status),
      };
    }

    try {
      return ok((await response.json()) as unknown);
    } catch {
      return err(
        new ProviderError(provider, "bad_response", "response body was not valid JSON", 200),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST JSON with one retry on transient failure. Returns the parsed
 * response body; callers validate its shape (bad shape → bad_response).
 */
export async function postJson(args: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}): Promise<Result<unknown, ProviderError>> {
  const timeoutMs = args.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const first = await attempt(args.provider, args.url, args.headers, args.body, timeoutMs);
  if (first.ok || !first.retryable) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return attempt(args.provider, args.url, args.headers, args.body, timeoutMs);
}

/** Narrowing helper: is this value a plain object? */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
