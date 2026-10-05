import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createGeminiReader, GEMINI_MODEL, GeminiFailure, THINKING_BUDGET } from "../_shared/gemini.ts";
import type { GeminiFailureKind } from "../_shared/gemini.ts";
import { PROMPT_V0 } from "../_shared/prompt.ts";
import { CANARY_GEMINI_ERROR, JPEG_BYTES } from "./fakes.ts";

type Seen = { url: string; method: string | undefined; headers: Headers; body: Record<string, unknown> };

function recorder(respond: () => Response | Promise<Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Promise.resolve(respond());
  };
  return { fetch: fetcher as typeof fetch, seen };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const GOOD = {
  candidates: [{ content: { parts: [{ text: "Hello\nworld" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1100, candidatesTokenCount: 216, totalTokenCount: 1316 },
  modelVersion: "gemini-3.6-flash-001",
};

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

Deno.test("the request is the V0 prompt, the original photo and thinkingBudget 0, with no temperature", async () => {
  const { fetch, seen } = recorder(() => ok(GOOD));
  await createGeminiReader({ apiKey: "test-key", fetch })(JPEG_BYTES);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assertEquals(seen[0].method, "POST");
  assertEquals(seen[0].headers.get("x-goog-api-key"), "test-key");
  assertEquals(seen[0].headers.get("content-type"), "application/json");
  assertEquals(seen[0].body, {
    contents: [{
      parts: [
        { text: PROMPT_V0 },
        { inlineData: { mimeType: "image/jpeg", data: base64(JPEG_BYTES) } },
      ],
    }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });
});

Deno.test("the key is never put in the address", async () => {
  const { fetch, seen } = recorder(() => ok(GOOD));
  await createGeminiReader({ apiKey: "KEY-NOT-IN-URL", fetch })(JPEG_BYTES);
  assertEquals(seen[0].url.includes("KEY-NOT-IN-URL"), false);
  assertEquals(seen[0].url.includes("key="), false);
});

Deno.test("the model and the thinking budget are the fixed production values", () => {
  assertEquals(GEMINI_MODEL, "gemini-3.6-flash");
  assertEquals(THINKING_BUDGET, 0);
});

Deno.test("the text and the usage are read from the response", async () => {
  const { fetch } = recorder(() => ok(GOOD));
  const reading = await createGeminiReader({ apiKey: "k", fetch })(JPEG_BYTES);
  assertEquals(reading, { text: "Hello\nworld", modelVersion: "gemini-3.6-flash-001", inputTokens: 1100, outputTokens: 216, thoughtsTokens: 0 });
});

Deno.test("the text is returned exactly as received, without trimming", async () => {
  const body = { ...GOOD, candidates: [{ content: { parts: [{ text: "  line one\n" }, { text: "line two\n\n" }] }, finishReason: "STOP" }] };
  const { fetch } = recorder(() => ok(body));
  const reading = await createGeminiReader({ apiKey: "k", fetch })(JPEG_BYTES);
  assertEquals(reading.text, "  line one\nline two\n\n");
});

Deno.test("thought parts are not part of the text, and thought tokens are reported", async () => {
  const body = {
    candidates: [{ content: { parts: [{ text: "hidden reasoning", thought: true }, { text: "the page" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
  };
  const { fetch } = recorder(() => ok(body));
  const reading = await createGeminiReader({ apiKey: "k", fetch })(JPEG_BYTES);
  assertEquals(reading.text, "the page");
  assertEquals(reading.thoughtsTokens, 7);
  assertEquals(reading.modelVersion, null);
});

const FAILURES: [string, () => Response | Promise<Response>, GeminiFailureKind][] = [
  ["a network error", () => Promise.reject(new TypeError(`${CANARY_GEMINI_ERROR} connection reset`)), "network"],
  ["a 500", () => new Response(`${CANARY_GEMINI_ERROR}`, { status: 500 }), "http_error"],
  ["a 429", () => new Response(JSON.stringify({ error: { message: CANARY_GEMINI_ERROR } }), { status: 429 }), "http_error"],
  ["a 400", () => new Response(JSON.stringify({ error: { message: CANARY_GEMINI_ERROR } }), { status: 400 }), "http_error"],
  ["a body that is not JSON", () => new Response(`${CANARY_GEMINI_ERROR} <html>`, { status: 200 }), "bad_response"],
  ["no candidate", () => ok({ promptFeedback: { blockReason: "SAFETY" } }), "no_candidate"],
  ["a finish reason other than STOP", () => ok({ candidates: [{ content: { parts: [{ text: "cut" }] }, finishReason: "MAX_TOKENS" }] }), "bad_finish"],
  ["an empty text", () => ok({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] }), "empty_text"],
  ["a text of spaces only", () => ok({ candidates: [{ content: { parts: [{ text: " \n " }] }, finishReason: "STOP" }] }), "empty_text"],
];

for (const [name, respond, kind] of FAILURES) {
  Deno.test(`${name} fails with kind ${kind} and carries nothing from the response`, async () => {
    const { fetch } = recorder(respond);
    const error = await assertRejects(() => createGeminiReader({ apiKey: "k", fetch })(JPEG_BYTES), GeminiFailure);
    assertEquals(error.kind, kind);
    assertEquals(error.message, kind);
    assert(!String(error).includes(CANARY_GEMINI_ERROR));
    assert(!JSON.stringify(error).includes(CANARY_GEMINI_ERROR));
  });
}

Deno.test("an attempt that takes longer than the limit fails with kind timeout", async () => {
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  const error = await assertRejects(() => createGeminiReader({ apiKey: "k", fetch: hanging, timeoutMs: 20 })(JPEG_BYTES), GeminiFailure);
  assertEquals(error.kind, "timeout");
});
