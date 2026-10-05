import { GEMINI_MODEL, GeminiFailure, THINKING_BUDGET } from "../_shared/gemini.ts";
import type { GeminiReading } from "../_shared/gemini.ts";
import { admit, failed, json, refuse } from "../_shared/http.ts";
import { looksLikeJpeg, MAX_PHOTO_BYTES, PHOTO_MIME_TYPE, photoPath } from "../_shared/photo.ts";
import { errorName } from "../_shared/log.ts";
import type { PageRow, ReadPageDeps } from "../_shared/ports.ts";
import { PROMPT_VERSION } from "../_shared/prompt.ts";
import { refusalForCharge, refusalForStatus } from "../_shared/refusals.ts";
import type { Refusal } from "../_shared/refusals.ts";

export const PIPELINE_VERSION = "b1-raw";

const ATTEMPTS = 2;

const MAX_RELAUNCHES = 3;

const PHOTO_MISSING: Refusal = { status: 422, code: "photo_missing" };
const PHOTO_NOT_JPEG: Refusal = { status: 422, code: "photo_not_jpeg" };
const PHOTO_TOO_LARGE: Refusal = { status: 422, code: "photo_too_large" };

type Attempt = { reading: GeminiReading; durationMs: number } | null;

async function attemptReading(deps: ReadPageDeps, pageId: string, image: Uint8Array): Promise<Attempt> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = deps.clock.now();
    try {
      const reading = await deps.gemini(image);
      return { reading, durationMs: deps.clock.now() - started };
    } catch (error) {
      deps.log.event("gemini_attempt_failed", { pageId, attempt, kind: error instanceof GeminiFailure ? error.kind : "unknown" });
    }
  }
  return null;
}

async function queueForRetry(deps: ReadPageDeps, userId: string, page: PageRow): Promise<Response> {
  const failedRelaunches = page.retryCount + (page.queueReason === "read_error" ? 1 : 0);
  if (failedRelaunches >= MAX_RELAUNCHES) {
    await deps.server.markFailed(userId, page.id, MAX_RELAUNCHES);
    deps.log.event("read_failed", { pageId: page.id, code: "relaunches_exhausted" });
    return json(200, { status: "failed" });
  }
  await deps.server.releaseToQueue(userId, page.id, "read_error", failedRelaunches);
  deps.log.event("read_queued", { pageId: page.id, code: "read_error" });
  return json(200, { status: "queued", queue_reason: "read_error" });
}

async function storeReading(deps: ReadPageDeps, userId: string, pageId: string, done: NonNullable<Attempt>): Promise<void> {
  const { reading, durationMs } = done;
  const outputTokens = reading.outputTokens + reading.thoughtsTokens;
  await deps.server.insertReading(userId, pageId, {
    label: "B1",
    rawText: reading.text,
    model: GEMINI_MODEL,
    modelVersion: reading.modelVersion ?? GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
    thinkingBudget: THINKING_BUDGET,
    inputTokens: reading.inputTokens,
    outputTokens,
    durationMs,
  });
  await deps.server.upsertPageText(userId, pageId, reading.text, PIPELINE_VERSION);
  await deps.server.markRead(userId, pageId, new Date(deps.clock.now()).toISOString());
  deps.log.event("read_done", {
    pageId,
    durationMs,
    inputTokens: reading.inputTokens,
    outputTokens,
    thoughtsTokens: reading.thoughtsTokens,
  });
}

export async function handleReadPage(request: Request, deps: ReadPageDeps): Promise<Response> {
  try {
    const entry = await admit(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const { token, caller, pageId } = entry;
    const userId = caller.userId;
    const store = deps.forCaller(token);

    const page = await store.getPage(pageId);
    if (!page || page.userId !== userId) {
      return refuse(deps.log, { status: 404, code: "page_not_found" }, pageId);
    }
    const notReadable = refusalForStatus(page.status);
    if (notReadable) return refuse(deps.log, notReadable, pageId);

    const path = photoPath(userId, pageId);
    const info = await store.photoInfo(path);
    if (!info) return refuse(deps.log, PHOTO_MISSING, pageId);
    if (info.mimeType !== PHOTO_MIME_TYPE) return refuse(deps.log, PHOTO_NOT_JPEG, pageId);
    if (info.size > MAX_PHOTO_BYTES) return refuse(deps.log, PHOTO_TOO_LARGE, pageId);
    const image = await store.downloadPhoto(path);
    if (!image) return refuse(deps.log, PHOTO_MISSING, pageId);
    if (image.length > MAX_PHOTO_BYTES) return refuse(deps.log, PHOTO_TOO_LARGE, pageId);
    if (!looksLikeJpeg(image)) return refuse(deps.log, PHOTO_NOT_JPEG, pageId);

    const charge = await deps.server.charge(pageId);
    const refused = refusalForCharge(charge.reason);
    if (refused) return refuse(deps.log, refused, pageId);
    deps.log.event("charged", { pageId, code: charge.reason });
    await deps.server.recordOriginalImage(userId, pageId, path);

    if (!(await deps.server.claimForReading(userId, pageId, { queueReason: page.queueReason, retryCount: page.retryCount }))) {
      return refuse(deps.log, { status: 409, code: "page_processing" }, pageId);
    }

    const done = await attemptReading(deps, pageId, image);
    if (!done) return await queueForRetry(deps, userId, page);
    try {
      await storeReading(deps, userId, pageId, done);
    } catch (error) {
      deps.log.event("unexpected_error", { errorName: errorName(error) });
      return await queueForRetry(deps, userId, page);
    }
    return json(200, { status: "read" });
  } catch (error) {
    return failed(deps.log, error);
  }
}
