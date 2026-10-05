import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PROMPT_V0, PROMPT_VERSION } from "../_shared/prompt.ts";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("the V0 prompt is the production text, character for character", async () => {
  assertEquals(PROMPT_V0.length, 379);
  assertEquals(new TextEncoder().encode(PROMPT_V0).length, 379);
  assertEquals(await sha256(PROMPT_V0), "7c2ae7e2c7bbd14dcd03914ad48dea0bbaea4de1d36d4e27b9ef28384b8956c7");
});

Deno.test("the V0 prompt has no trailing newline and no carriage return", () => {
  assertEquals(PROMPT_V0.endsWith("\n"), false);
  assertEquals(PROMPT_V0.includes("\r"), false);
});

Deno.test("the V0 prompt keeps the verbatim clause and the layout clauses", () => {
  assertStringIncludes(PROMPT_V0, "exactly as written. Rules:");
  assertStringIncludes(PROMPT_V0, "- Reproduce the text verbatim, including spelling and grammar mistakes. Do not correct anything.");
  assertStringIncludes(PROMPT_V0, "- Preserve line breaks as they appear on the page.");
  assertStringIncludes(PROMPT_V0, "- Ignore crossed-out text.");
});

Deno.test("the prompt version stored with each reading is v0", () => {
  assertEquals(PROMPT_VERSION, "v0");
});
