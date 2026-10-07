import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import type { Auth, Caller } from "./ports.ts";
import type { Refusal } from "./refusals.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function refuse(log: Logger, refusal: Refusal, pageId?: string): Response {
  log.event("refused", { code: refusal.code, status: refusal.status, pageId });
  return json(refusal.status, { error: refusal.code });
}

export function failed(log: Logger, error: unknown): Response {
  log.event("unexpected_error", { errorName: errorName(error) });
  return json(500, { error: "internal_error" });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : null;
}

export async function pageIdFrom(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const pageId = (body as Record<string, unknown>).page_id;
  return typeof pageId === "string" && UUID.test(pageId) ? pageId.toLowerCase() : null;
}

const RELAUNCH_SECRET_HEADER = "x-relaunch-secret";

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export type Entry = { token: string; caller: Caller; pageId: string };

export type SchedulerEntry = { pageId: string };

export type CallerEntry = { token: string; caller: Caller };

export async function admitCaller(request: Request, auth: Auth, log: Logger): Promise<CallerEntry | Response> {
  if (request.method !== "POST") return refuse(log, { status: 405, code: "method_not_allowed" });
  const token = bearerToken(request);
  const caller = token ? await auth.verify(token) : null;
  if (!token || !caller) return refuse(log, { status: 401, code: "unauthenticated" });
  return { token, caller };
}

export async function admit(request: Request, auth: Auth, log: Logger): Promise<Entry | Response> {
  const entry = await admitCaller(request, auth, log);
  if (entry instanceof Response) return entry;
  const pageId = await pageIdFrom(request);
  if (!pageId) return refuse(log, { status: 400, code: "invalid_request" });
  return { ...entry, pageId };
}

export async function admitScheduler(request: Request, secret: string, log: Logger): Promise<SchedulerEntry | Response> {
  if (request.method !== "POST") return refuse(log, { status: 405, code: "method_not_allowed" });
  const given = request.headers.get(RELAUNCH_SECRET_HEADER);
  if (!secret || !given || !(await sameSecret(given, secret))) return refuse(log, { status: 401, code: "unauthenticated" });
  const pageId = await pageIdFrom(request);
  if (!pageId) return refuse(log, { status: 400, code: "invalid_request" });
  return { pageId };
}
