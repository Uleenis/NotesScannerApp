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
];

export type ServiceFailureKind = "network" | "timeout" | "http_error" | "bad_response" | "cancelled";

export type ServiceFailure = { kind: ServiceFailureKind; status?: number; code?: string };

export type Recognized = { ok: true; answer: string } | { ok: false; failure: ServiceFailure };

export type Arbitration = { pageId: string; userId: string; b1: string; answer: string; durationMs: number };

export type Arbitrated = { ok: true; tokens: number | null } | { ok: false; failure: ServiceFailure };

export type ReadingService = {
  recognize: (pageId: string, image: Uint8Array, signal: AbortSignal) => Promise<Recognized>;
  arbitrate: (arbitration: Arbitration, signal: AbortSignal) => Promise<Arbitrated>;
};

type ServiceOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  recognizeTimeoutMs?: number;
  arbitrateTimeoutMs?: number;
  maxAnswerBytes?: number;
};

export class ReadingServiceConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReadingServiceConfigError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parsed(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

function originOf(url: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ReadingServiceConfigError("READING_URL is not an address");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
    throw new ReadingServiceConfigError("READING_URL must be an origin alone");
  }
  const host = parsedUrl.hostname;
  const local = LOCAL_HOSTS.includes(host) || (!host.includes(".") && !host.includes(":") && host.length > 0);
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && local)) {
    throw new ReadingServiceConfigError("READING_URL must use https");
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
    recognize: async (pageId, image, caller) => {
      const query = new URLSearchParams({ page_id: pageId });
      const sent = await post(`/recognize?${query}`, "image/jpeg", image.slice(), options.recognizeTimeoutMs ?? RECOGNIZE_TIMEOUT_MS, caller);
      if ("failure" in sent) return { ok: false, failure: sent.failure };
      if (sent.response.status !== 200) return { ok: false, failure: await refusalOf(sent.response) };
      const answer = await bodyOf(sent, caller);
      if (typeof answer !== "string") return { ok: false, failure: answer };
      if (parsed(answer)?.page_id !== pageId) return { ok: false, failure: { kind: "bad_response" } };
      return { ok: true, answer };
    },
    arbitrate: async (arbitration, caller) => {
      const body = [
        `{"page_id":${JSON.stringify(arbitration.pageId)}`,
        `"user_id":${JSON.stringify(arbitration.userId)}`,
        `"b1":${JSON.stringify(arbitration.b1)}`,
        `"duration_ms":${JSON.stringify(arbitration.durationMs)}`,
        `"a":${arbitration.answer}}`,
      ].join(",");
      const sent = await post("/arbitrate", "application/json", body, options.arbitrateTimeoutMs ?? ARBITRATE_TIMEOUT_MS, caller);
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

export function readingServiceFrom(get: (name: string) => string | undefined, fetchImpl?: typeof fetch): ReadingService | null {
  const url = get("READING_URL");
  const secret = get("READING_SECRET");
  if (!url && !secret) return null;
  if (!url || !secret) throw new ReadingServiceConfigError("READING_URL and READING_SECRET go together");
  if (secret.length < MIN_SECRET_LENGTH || secret.trim() !== secret) {
    throw new ReadingServiceConfigError("READING_SECRET is too short or has spaces around it");
  }
  return createReadingService({ url: originOf(url), secret, fetch: fetchImpl });
}
