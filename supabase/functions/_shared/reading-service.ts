import type { Logger } from "./log.ts";
import type { Sheet, WritingTemplate } from "./writing-test.ts";

export const RECOGNIZE_TIMEOUT_MS = 135_000;

export const ARBITRATE_TIMEOUT_MS = 30_000;

export const MAX_ANSWER_BYTES = 11 * 1024 * 1024;

const MIN_SECRET_LENGTH = 32;

const SECRET_HEADER = "x-reading-secret";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const KNOWN_CODES = [
  "unauthorized",
  "invalid_request",
  "invalid_photo",
  "too_large",
  "unsupported_media_type",
  "too_complex",
  "busy",
  "reading_failed",
  "arbitration_failed",
  "page_not_found",
  "not_text",
  "already_read",
  "model_not_found",
];

export type ServiceFailureKind = "network" | "timeout" | "http_error" | "bad_response" | "cancelled";

export type ServiceFailure = { kind: ServiceFailureKind; status?: number; code?: string };

export type Recognized = { ok: true; answer: string } | { ok: false; failure: ServiceFailure };

export type Arbitration = { pageId: string; userId: string; b1: string; b2: string | null; answer: string; durationMs: number };

export type Arbitrated = { ok: true; tokens: number | null } | { ok: false; failure: ServiceFailure };

export type Checked = { ok: true; lines: number; training: number; validation: number } | { ok: false; failure: ServiceFailure };

export type ReadingService = {
  checkWriting: (template: WritingTemplate, sheet: Sheet, image: Uint8Array, signal: AbortSignal, timeoutMs?: number) => Promise<Checked>;
  recognize: (pageId: string, userId: string, image: Uint8Array, signal: AbortSignal, timeoutMs?: number) => Promise<Recognized>;
  arbitrate: (arbitration: Arbitration, signal: AbortSignal, timeoutMs?: number) => Promise<Arbitrated>;
};

type ServiceOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  recognizeTimeoutMs?: number;
  arbitrateTimeoutMs?: number;
  maxAnswerBytes?: number;
};

type ConfigProblem = "half_configured" | "weak_secret" | "not_an_address" | "not_an_origin" | "not_https" | "proxy_on_http";

export class ReadingServiceConfigError extends Error {
  readonly code: ConfigProblem;

  constructor(code: ConfigProblem) {
    super(code);
    this.name = "ReadingServiceConfigError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const MODEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function namesAModel(answer: Record<string, unknown>): boolean {
  return "model_id" in answer && (answer.model_id === null || (typeof answer.model_id === "string" && MODEL_ID.test(answer.model_id)));
}

function parsed(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

const HTTP_PROXY_NAMES = ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function bypassed(host: string, noProxy: string): boolean {
  return noProxy.split(",").map((entry) => entry.trim().toLowerCase().replace(/^\./, "")).some((entry) =>
    entry === "*" || (entry.length > 0 && (host === entry || host.endsWith(`.${entry}`)))
  );
}

function originOf(url: string, get: (name: string) => string | undefined): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ReadingServiceConfigError("not_an_address");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
    throw new ReadingServiceConfigError("not_an_origin");
  }
  if (parsedUrl.protocol === "https:") return parsedUrl.origin;
  const host = parsedUrl.hostname;
  const local = LOCAL_HOSTS.includes(host) || (!host.includes(".") && !host.includes(":") && host.length > 0);
  const stackIsLocal = (get("SUPABASE_URL") ?? "").startsWith("http://");
  if (parsedUrl.protocol !== "http:" || !local || !stackIsLocal) {
    throw new ReadingServiceConfigError("not_https");
  }
  const noProxy = get("NO_PROXY") ?? get("no_proxy") ?? "";
  if (HTTP_PROXY_NAMES.some((name) => get(name)) && !bypassed(host, noProxy)) {
    throw new ReadingServiceConfigError("proxy_on_http");
  }
  return parsedUrl.origin;
}

async function boundedText(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

async function refusalOf(response: Response): Promise<ServiceFailure> {
  const text = response.status >= 300 && response.status < 400 ? null : await boundedText(response, 4096).catch(() => null);
  if (text === null) await response.body?.cancel().catch(() => undefined);
  const code = text === null ? undefined : parsed(text)?.error;
  return typeof code === "string" && KNOWN_CODES.includes(code)
    ? { kind: "http_error", status: response.status, code }
    : { kind: "http_error", status: response.status };
}

function within(limit: number, given: number | undefined): number {
  return given === undefined ? limit : Math.max(1, Math.min(limit, given));
}

type Sent = { response: Response; signal: AbortSignal } | { failure: ServiceFailure };

function failureOfThrown(signal: AbortSignal, caller: AbortSignal): ServiceFailure {
  if (caller.aborted) return { kind: "cancelled" };
  return { kind: signal.aborted ? "timeout" : "network" };
}

export function createReadingService(options: ServiceOptions): ReadingService {
  const origin = options.url.replace(/\/$/, "");
  const send = options.fetch ?? globalThis.fetch;
  const maxAnswerBytes = options.maxAnswerBytes ?? MAX_ANSWER_BYTES;

  async function post(path: string, contentType: string, body: BodyInit, timeoutMs: number, caller: AbortSignal): Promise<Sent> {
    const signal = AbortSignal.any([caller, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await send(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": contentType, [SECRET_HEADER]: options.secret },
        body,
        redirect: "manual",
        signal,
      });
      return { response, signal };
    } catch {
      return { failure: failureOfThrown(signal, caller) };
    }
  }

  async function bodyOf(sent: { response: Response; signal: AbortSignal }, caller: AbortSignal): Promise<string | ServiceFailure> {
    try {
      return await boundedText(sent.response, maxAnswerBytes) ?? { kind: "bad_response" };
    } catch {
      return sent.signal.aborted ? failureOfThrown(sent.signal, caller) : { kind: "network" };
    }
  }

  return {
    recognize: async (pageId, userId, image, caller, timeoutMs) => {
      const query = new URLSearchParams({ page_id: pageId, user_id: userId });
      const sent = await post(`/recognize?${query}`, "image/jpeg", image.slice(), within(options.recognizeTimeoutMs ?? RECOGNIZE_TIMEOUT_MS, timeoutMs), caller);
      if ("failure" in sent) return { ok: false, failure: sent.failure };
      if (sent.response.status !== 200) return { ok: false, failure: await refusalOf(sent.response) };
      const answer = await bodyOf(sent, caller);
      if (typeof answer !== "string") return { ok: false, failure: answer };
      const found = parsed(answer);
      if (found?.page_id !== pageId || !namesAModel(found)) return { ok: false, failure: { kind: "bad_response" } };
      return { ok: true, answer };
    },
    checkWriting: async (template, sheet, image, caller, timeoutMs) => {
      const query = new URLSearchParams({ template, sheet: String(sheet) });
      const sent = await post(`/check-writing?${query}`, "image/jpeg", image.slice(), within(options.recognizeTimeoutMs ?? RECOGNIZE_TIMEOUT_MS, timeoutMs), caller);
      if ("failure" in sent) return { ok: false, failure: sent.failure };
      if (sent.response.status !== 200) return { ok: false, failure: await refusalOf(sent.response) };
      const text = await boundedText(sent.response, 4096).catch(() => null);
      const found = text === null ? null : parsed(text);
      const counts = [found?.lines, found?.training, found?.validation];
      const bounded = found !== null && found.template === template && found.sheet === sheet &&
        counts.every((count) => Number.isInteger(count) && (count as number) >= 0) &&
        (found.lines as number) <= 60 && (found.training as number) <= 20 && (found.validation as number) <= 10;
      if (!bounded) return { ok: false, failure: { kind: "bad_response" } };
      return { ok: true, lines: found.lines as number, training: found.training as number, validation: found.validation as number };
    },
    arbitrate: async (arbitration, caller, timeoutMs) => {
      const body = [
        `{"page_id":${JSON.stringify(arbitration.pageId)}`,
        `"user_id":${JSON.stringify(arbitration.userId)}`,
        `"b1":${JSON.stringify(arbitration.b1)}`,
        ...(arbitration.b2 === null ? [] : [`"b2":${JSON.stringify(arbitration.b2)}`]),
        `"duration_ms":${JSON.stringify(arbitration.durationMs)}`,
        `"a":${arbitration.answer}}`,
      ].join(",");
      const sent = await post("/arbitrate", "application/json", body, within(options.arbitrateTimeoutMs ?? ARBITRATE_TIMEOUT_MS, timeoutMs), caller);
      if ("failure" in sent) return { ok: false, failure: sent.failure };
      if (sent.response.status !== 200) return { ok: false, failure: await refusalOf(sent.response) };
      const text = await bodyOf(sent, caller);
      if (typeof text !== "string") return { ok: false, failure: text };
      const tokens = parsed(text)?.tokens;
      return { ok: true, tokens: Number.isInteger(tokens) ? tokens as number : null };
    },
  };
}

export function retryable(failure: ServiceFailure): boolean {
  if (failure.kind === "network" || failure.kind === "timeout") return true;
  if (failure.kind !== "http_error" || failure.status === undefined) return false;
  return failure.status === 429 || failure.status >= 500;
}

function configuredService(get: (name: string) => string | undefined, fetchImpl?: typeof fetch): ReadingService | null {
  const url = get("READING_URL");
  const secret = get("READING_SECRET");
  if (!url && !secret) return null;
  if (!url || !secret) throw new ReadingServiceConfigError("half_configured");
  if (secret.length < MIN_SECRET_LENGTH || secret.trim() !== secret) {
    throw new ReadingServiceConfigError("weak_secret");
  }
  return createReadingService({ url: originOf(url, get), secret, fetch: fetchImpl });
}

export function readingServiceFrom(get: (name: string) => string | undefined, log: Logger, fetchImpl?: typeof fetch): ReadingService | null {
  try {
    return configuredService(get, fetchImpl);
  } catch (error) {
    if (!(error instanceof ReadingServiceConfigError)) throw error;
    log.event("reading_service_misconfigured", { code: error.code });
    return null;
  }
}
