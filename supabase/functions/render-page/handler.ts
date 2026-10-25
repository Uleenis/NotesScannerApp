import { GEMINI_MODEL, GeminiFailure } from "../_shared/gemini.ts";
import { admitCaller, failed, json, refuse, UUID } from "../_shared/http.ts";
import type { RenderDeps } from "../_shared/ports.ts";
import { checkFidelity, fingerprint, MAX_RENDER_INPUT, renderInput } from "../_shared/render-check.ts";
import { RENDER_PROMPT_VERSION } from "../_shared/render-prompt.ts";

const ATTEMPTS = 2;

type Outcome = { status: "ready"; text: string } | { status: "limit" | "failed" | "discarded" };

const inflight = new Map<string, Promise<Outcome>>();

async function pageIdOnly(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== "page_id")) return null;
  const pageId = fields.page_id;
  return typeof pageId === "string" && UUID.test(pageId) ? pageId.toLowerCase() : null;
}

async function generate(deps: RenderDeps, pageId: string, input: string) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = deps.clock.now();
    try {
      const reading = await deps.gemini(input);
      return { reading, durationMs: deps.clock.now() - started };
    } catch (error) {
      if (!(error instanceof GeminiFailure)) throw error;
      deps.log.event("gemini_attempt_failed", { pageId, attempt, kind: error.kind, status: error.status });
      if (error.status === 429) break;
    }
  }
  return null;
}

async function produce(deps: RenderDeps, userId: string, pageId: string, input: string, basedOn: string): Promise<Outcome> {
  const charge = await deps.renders.charge(userId);
  if (!charge.allowed) {
    deps.log.event("render_limit", { pageId });
    return { status: "limit" };
  }
  const made = await generate(deps, pageId, input);
  if (!made) {
    deps.log.event("render_failed", { pageId });
    return { status: "failed" };
  }
  const { reading, durationMs } = made;
  const verdict = checkFidelity(input, reading.text);
  if (!verdict.ok) {
    deps.log.event("render_discarded", { pageId, code: verdict.reason, inputTokens: reading.inputTokens, outputTokens: reading.outputTokens, durationMs });
    return { status: "discarded" };
  }
  const current = await deps.renders.page(userId, pageId);
  if (!current || (await fingerprint(renderInput(current.text ?? ""))) !== basedOn) {
    deps.log.event("render_discarded", { pageId, code: "page_changed" });
    return { status: "discarded" };
  }
  await deps.renders.save(userId, pageId, { text: reading.text, basedOn, model: GEMINI_MODEL, promptVersion: RENDER_PROMPT_VERSION });
  deps.log.event("render_done", { pageId, inputTokens: reading.inputTokens, outputTokens: reading.outputTokens, durationMs });
  return { status: "ready", text: reading.text };
}

export async function handleRenderPage(request: Request, deps: RenderDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const pageId = await pageIdOnly(request);
    if (!pageId) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const userId = entry.caller.userId;
    const page = await deps.renders.page(userId, pageId);
    if (!page) return refuse(deps.log, { status: 404, code: "page_not_found" }, pageId);
    if (page.status !== "read") return refuse(deps.log, { status: 409, code: "page_not_read" }, pageId);
    if (page.pageType === "unsupported_script") return refuse(deps.log, { status: 409, code: "unsupported_script" }, pageId);

    const input = renderInput(page.text ?? "");
    if (input.trim() === "") return refuse(deps.log, { status: 409, code: "no_text" }, pageId);
    if (input.length > MAX_RENDER_INPUT) return refuse(deps.log, { status: 413, code: "text_too_long" }, pageId);

    const basedOn = await fingerprint(input);
    if (page.rendering && page.rendering.basedOn === basedOn) {
      deps.log.event("render_cached", { pageId });
      return json(200, { status: "ready", text: page.rendering.text });
    }

    const key = `${userId}:${pageId}:${basedOn}`;
    let task = inflight.get(key);
    if (!task) {
      task = produce(deps, userId, pageId, input, basedOn).finally(() => inflight.delete(key));
      inflight.set(key, task);
    }
    return json(200, await task);
  } catch (error) {
    return failed(deps.log, error);
  }
}
