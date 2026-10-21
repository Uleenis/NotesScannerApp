import { GEMINI_MODEL, GeminiFailure, THINKING_BUDGET } from "./gemini.ts";
import type { GeminiReading } from "./gemini.ts";
import type { ReadingDeps, ReadingInput, ReadingPass } from "./ports.ts";
import { PROMPT_VERSION } from "./prompt.ts";

const ATTEMPTS = 2;

export type Attempt = { reading: GeminiReading; durationMs: number } | null;

export async function attemptReading(
  deps: ReadingDeps,
  pageId: string,
  image: Uint8Array,
  pass: ReadingPass,
  stopped: AbortSignal = new AbortController().signal,
): Promise<Attempt> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (stopped.aborted) return null;
    const started = deps.clock.now();
    try {
      const reading = await deps.gemini(image, pass);
      return { reading, durationMs: deps.clock.now() - started };
    } catch (error) {
      deps.log.event("gemini_attempt_failed", {
        pageId,
        attempt,
        code: pass === "B1" ? undefined : pass,
        kind: error instanceof GeminiFailure ? error.kind : "unknown",
        status: error instanceof GeminiFailure ? error.status : undefined,
      });
    }
  }
  return null;
}

export function readingInput(label: ReadingPass, done: NonNullable<Attempt>): ReadingInput {
  const { reading, durationMs } = done;
  return {
    label,
    rawText: reading.text,
    model: GEMINI_MODEL,
    modelVersion: reading.modelVersion ?? GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
    thinkingBudget: THINKING_BUDGET,
    inputTokens: reading.inputTokens,
    outputTokens: reading.outputTokens + reading.thoughtsTokens,
    durationMs,
  };
}
