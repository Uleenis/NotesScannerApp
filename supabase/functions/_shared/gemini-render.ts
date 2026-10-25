import { callGemini } from "./gemini.ts";
import type { GeminiOptions, GeminiReading } from "./gemini.ts";
import { RENDER_PROMPT_R1 } from "./render-prompt.ts";

export const MAX_RENDER_OUTPUT_TOKENS = 16_384;

export type GeminiRenderer = (input: string) => Promise<GeminiReading>;

function requestBody(input: string): string {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: RENDER_PROMPT_R1 }] },
    contents: [{ role: "user", parts: [{ text: input }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: MAX_RENDER_OUTPUT_TOKENS },
  });
}

export function createGeminiRenderer(options: GeminiOptions): GeminiRenderer {
  return (input) => callGemini(options, requestBody(input));
}
