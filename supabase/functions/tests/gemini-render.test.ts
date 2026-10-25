import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { GeminiFailure, THINKING_BUDGET } from "../_shared/gemini.ts";
import { createGeminiRenderer, MAX_RENDER_OUTPUT_TOKENS } from "../_shared/gemini-render.ts";
import { RENDER_PROMPT_R1 } from "../_shared/render-prompt.ts";

function recorder(respond: () => Response): { fetch: typeof fetch; seen: { body: Record<string, unknown>; headers: Headers; url: string }[] } {
  const seen: { body: Record<string, unknown>; headers: Headers; url: string }[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Promise.resolve(respond());
  };
  return { fetch: fetcher as typeof fetch, seen };
}

function ok(text: string, finishReason = "STOP"): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("the request carries the prompt as instruction, the text alone as content, thinkingBudget 0 and a bound on the output [2]", async () => {
  const { fetch, seen } = recorder(() => ok("# Titre"));
  const rendered = await createGeminiRenderer({ apiKey: "k", fetch })("Titre");
  assertEquals(rendered.text, "# Titre");
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assertEquals(seen[0].headers.get("x-goog-api-key"), "k");
  assertEquals(seen[0].body, {
    systemInstruction: { parts: [{ text: RENDER_PROMPT_R1 }] },
    contents: [{ role: "user", parts: [{ text: "Titre" }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: THINKING_BUDGET }, maxOutputTokens: MAX_RENDER_OUTPUT_TOKENS },
  });
  assertEquals(THINKING_BUDGET, 0);
});

Deno.test("an answer cut by the bound on the output is a failure [2]", async () => {
  const { fetch } = recorder(() => ok("# Titre", "MAX_TOKENS"));
  const error = await assertRejects(() => createGeminiRenderer({ apiKey: "k", fetch })("Titre"), GeminiFailure);
  assertEquals(error.kind, "bad_finish");
});
