import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicGeneration } from "../../src/providers/anthropic";
import { createOpenAIEmbeddings, createOpenAIGeneration } from "../../src/providers/openai";
import { createVoyageEmbeddings } from "../../src/providers/voyage";
import { EMBEDDING_DIMENSIONS } from "../../src/providers/llm";

/**
 * Real-provider adapters against a stubbed global fetch (adapter-test
 * pattern, zero network): request shape, response parsing, typed errors,
 * retry-once. These are the ONLY places the wire formats live, so the
 * tests pin them exactly.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: Array<() => Response>) {
  let call = 0;
  const spy = vi.fn(async () => {
    const responder = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return responder();
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const anthropicBody = JSON.stringify({
  content: [{ type: "text", text: "hello from claude" }],
  model: "claude-haiku-4-5",
  usage: { input_tokens: 12, output_tokens: 7 },
});

describe("anthropic generation provider", () => {
  it("POSTs the Messages API shape with versioned headers and maps the response", async () => {
    const spy = stubFetch(() => new Response(anthropicBody, { status: 200 }));
    const provider = createAnthropicGeneration({ apiKey: "sk-ant-test" });
    const result = await provider.generate({ system: "SYS", prompt: "USER", tier: "bulk" });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-haiku-4-5"); // bulk default
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
    expect(body.max_tokens).toBe(1024);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.text).toBe("hello from claude");
    expect(result.value.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("draft tier selects the draft model; env-style overrides apply", async () => {
    const spy = stubFetch(() => new Response(anthropicBody, { status: 200 }));
    const provider = createAnthropicGeneration({
      apiKey: "k",
      draftModel: "claude-custom-draft",
    });
    await provider.generate({ system: "s", prompt: "p", tier: "draft", maxTokens: 999 });
    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.model).toBe("claude-custom-draft");
    expect(body.max_tokens).toBe(999);
  });

  it("retries once on 5xx, then succeeds", async () => {
    const spy = stubFetch(
      () => new Response("overloaded", { status: 529, statusText: "Overloaded" }),
      () => new Response(anthropicBody, { status: 200 }),
    );
    const provider = createAnthropicGeneration({ apiKey: "k" });
    const result = await provider.generate({ system: "s", prompt: "p", tier: "bulk" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("does NOT retry a 401 and returns a typed http_error without the key", async () => {
    const spy = stubFetch(
      () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }),
    );
    const provider = createAnthropicGeneration({ apiKey: "sk-ant-supersecret" });
    const result = await provider.generate({ system: "s", prompt: "p", tier: "bulk" });
    expect(spy).toHaveBeenCalledTimes(1);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("http_error");
    expect(result.error.status).toBe(401);
    expect(result.error.message).not.toContain("supersecret");
  });

  it("maps a malformed 200 body to bad_response", async () => {
    stubFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    const provider = createAnthropicGeneration({ apiKey: "k" });
    const result = await provider.generate({ system: "s", prompt: "p", tier: "bulk" });
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("bad_response");
  });
});

describe("openai generation provider", () => {
  const chatBody = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "hello from gpt" } }],
    model: "gpt-4o-mini",
    usage: { prompt_tokens: 20, completion_tokens: 9 },
  });

  it("POSTs chat/completions with Bearer auth, system+user messages", async () => {
    const spy = stubFetch(() => new Response(chatBody, { status: 200 }));
    const provider = createOpenAIGeneration({ apiKey: "sk-oai-test" });
    const result = await provider.generate({ system: "SYS", prompt: "USER", tier: "bulk" });

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-oai-test");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.text).toBe("hello from gpt");
    expect(result.value.usage).toEqual({ inputTokens: 20, outputTokens: 9 });
  });

  it("draft tier defaults to gpt-4o", async () => {
    const spy = stubFetch(() => new Response(chatBody, { status: 200 }));
    await createOpenAIGeneration({ apiKey: "k" }).generate({
      system: "s",
      prompt: "p",
      tier: "draft",
    });
    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o");
  });
});

describe("openai embeddings provider", () => {
  it("requests dimensions=1024, sorts rows by index, fits dims", async () => {
    const vec = (fill: number) => new Array(EMBEDDING_DIMENSIONS).fill(fill);
    const spy = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: vec(0.2) }, // deliberately out of order
              { index: 0, embedding: vec(0.1) },
            ],
          }),
          { status: 200 },
        ),
    );
    const provider = createOpenAIEmbeddings({ apiKey: "k" });
    const result = await provider.embed(["first", "second"]);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(body.input).toEqual(["first", "second"]);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(2);
    // Sorted by index: row 0 came second in the payload but first out.
    // Both are constant vectors → after normalization all entries equal.
    expect(result.value[0]![0]).toBeCloseTo(1 / Math.sqrt(EMBEDDING_DIMENSIONS), 8);
  });

  it("wrong row count → bad_response", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }), { status: 200 }),
    );
    const result = await createOpenAIEmbeddings({ apiKey: "k" }).embed(["a", "b"]);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("bad_response");
  });
});

describe("voyage embeddings provider", () => {
  it("POSTs voyage-3.5-lite with Bearer auth and pads short vectors to 1024 normalized dims", async () => {
    const spy = stubFetch(
      () =>
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 4] }] }), { status: 200 }),
    );
    const provider = createVoyageEmbeddings({ apiKey: "pa-test" });
    const result = await provider.embed(["hello"]);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pa-test");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("voyage-3.5-lite");

    if (!result.ok) throw new Error(result.error.message);
    const v = result.value[0]!;
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    // [3,4] padded then normalized → [0.6, 0.8, 0, 0, ...]
    expect(v[0]).toBeCloseTo(0.6, 8);
    expect(v[1]).toBeCloseTo(0.8, 8);
    expect(v[2]).toBe(0);
  });

  it("empty batch short-circuits without a network call", async () => {
    const spy = stubFetch(() => new Response("should not be called", { status: 500 }));
    const result = await createVoyageEmbeddings({ apiKey: "k" }).embed([]);
    expect(spy).not.toHaveBeenCalled();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual([]);
  });
});
