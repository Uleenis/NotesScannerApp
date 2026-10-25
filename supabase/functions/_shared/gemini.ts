import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { PROMPT_V0 } from "./prompt.ts";

export const GEMINI_MODEL = "gemini-3.6-flash";

export const THINKING_BUDGET = 0;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_TIMEOUT_MS = 60_000;

export type GeminiFailureKind =
  | "network"
  | "timeout"
  | "http_error"
  | "bad_response"
  | "no_candidate"
  | "bad_finish"
  | "empty_text";

export class GeminiFailure extends Error {
  readonly kind: GeminiFailureKind;
  readonly status: number | undefined;

  constructor(kind: GeminiFailureKind, status?: number) {
    super(kind);
    this.name = "GeminiFailure";
    this.kind = kind;
    this.status = status;
  }
}

export type GeminiReading = {
  text: string;
  modelVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
};

export type GeminiOptions = { apiKey: string; fetch?: typeof fetch; timeoutMs?: number };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function requestBody(image: Uint8Array): string {
  return JSON.stringify({
    contents: [{
      parts: [
        { text: PROMPT_V0 },
        { inlineData: { mimeType: "image/jpeg", data: encodeBase64(image) } },
      ],
    }],
    generationConfig: { thinkingConfig: { thinkingBudget: THINKING_BUDGET } },
  });
}

function readResponse(body: unknown): GeminiReading {
  const root = record(body);
  const candidates = root && Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = record(candidates[0]);
  if (!candidate) throw new GeminiFailure("no_candidate");
  if (candidate.finishReason !== "STOP") throw new GeminiFailure("bad_finish");
  const content = record(candidate.content);
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map(record)
    .filter((part): part is Record<string, unknown> => part !== null && typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text as string)
    .join("");
  if (text.trim() === "") throw new GeminiFailure("empty_text");
  const usage = record(root?.usageMetadata);
  return {
    text,
    modelVersion: typeof root?.modelVersion === "string" ? root.modelVersion : null,
    inputTokens: count(usage?.promptTokenCount),
    outputTokens: count(usage?.candidatesTokenCount),
    thoughtsTokens: count(usage?.thoughtsTokenCount),
  };
}

export async function callGemini(options: GeminiOptions, body: string): Promise<GeminiReading> {
  const send = options.fetch ?? globalThis.fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await send(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body,
      signal,
    });
  } catch {
    throw new GeminiFailure(signal.aborted ? "timeout" : "network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GeminiFailure("http_error", response.status);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new GeminiFailure(signal.aborted ? "timeout" : "bad_response");
  }
  return readResponse(parsed);
}

export function createGeminiReader(options: GeminiOptions): (image: Uint8Array) => Promise<GeminiReading> {
  return (image) => callGemini(options, requestBody(image));
}
