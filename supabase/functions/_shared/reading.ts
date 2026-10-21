import { attemptReading, readingInput } from "./gemini-pass.ts";
import type { Attempt } from "./gemini-pass.ts";
import { failed, json, refuse } from "./http.ts";
import { errorName } from "./log.ts";
import { pageTypeOf } from "./page-type.ts";
import type { PageType } from "./page-type.ts";
import { looksLikeJpeg, MAX_PHOTO_BYTES, PHOTO_MIME_TYPE, photoPath } from "./photo.ts";
import type { ClaimExpectation, PageReader, PageRow, ReadingDeps } from "./ports.ts";
import { startReadingA } from "./reading-a.ts";
import type { ReadingA } from "./reading-a.ts";
import { startSecondPass } from "./reading-b2.ts";
import type { SecondPass } from "./reading-b2.ts";
import { MANUAL_RELAUNCH_INTERVAL_MS, refusalForCharge, refusalForReading } from "./refusals.ts";
import type { Refusal } from "./refusals.ts";

export const PIPELINE_VERSION = "b1-raw";

const MAX_RELAUNCHES = 3;

const PHOTO_MISSING: Refusal = { status: 422, code: "photo_missing" };
const PHOTO_NOT_JPEG: Refusal = { status: 422, code: "photo_not_jpeg" };
const PHOTO_TOO_LARGE: Refusal = { status: 422, code: "photo_too_large" };

export type Reader = { kind: "owner"; userId: string; pages: PageReader } | { kind: "scheduler"; pages: PageReader };

async function queueForRetry(deps: ReadingDeps, userId: string, page: PageRow): Promise<Response> {
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

async function storeReading(deps: ReadingDeps, userId: string, pageId: string, done: NonNullable<Attempt>, pageType: PageType): Promise<void> {
  const { reading, durationMs } = done;
  await deps.server.insertReading(userId, pageId, readingInput("B1", done));
  await deps.server.upsertPageText(userId, pageId, reading.text, PIPELINE_VERSION);
  await deps.server.markRead(userId, pageId, new Date(deps.clock.now()).toISOString(), pageType);
  deps.log.event("read_done", {
    pageId,
    durationMs,
    inputTokens: reading.inputTokens,
    outputTokens: reading.outputTokens + reading.thoughtsTokens,
    thoughtsTokens: reading.thoughtsTokens,
  });
}

function claimExpectation(page: PageRow, nowMs: number): ClaimExpectation {
  if (page.status === "failed") {
    return { status: "failed", retryCount: page.retryCount, relaunchedBefore: new Date(nowMs - MANUAL_RELAUNCH_INTERVAL_MS).toISOString() };
  }
  return { status: "queued", queueReason: page.queueReason, retryCount: page.retryCount };
}

async function photoRefusal(pages: PageReader, path: string): Promise<{ refusal: Refusal } | { image: Uint8Array }> {
  const info = await pages.photoInfo(path);
  if (!info) return { refusal: PHOTO_MISSING };
  if (info.mimeType !== PHOTO_MIME_TYPE) return { refusal: PHOTO_NOT_JPEG };
  if (info.size > MAX_PHOTO_BYTES) return { refusal: PHOTO_TOO_LARGE };
  const image = await pages.downloadPhoto(path);
  if (!image) return { refusal: PHOTO_MISSING };
  if (image.length > MAX_PHOTO_BYTES) return { refusal: PHOTO_TOO_LARGE };
  if (!looksLikeJpeg(image)) return { refusal: PHOTO_NOT_JPEG };
  return { image };
}

export async function readPage(deps: ReadingDeps, reader: Reader, pageId: string): Promise<Response> {
  try {
    const page = await reader.pages.getPage(pageId);
    if (!page || (reader.kind === "owner" && page.userId !== reader.userId)) {
      return refuse(deps.log, { status: 404, code: "page_not_found" }, pageId);
    }
    const userId = page.userId;
    const notReadable = refusalForReading(page, reader.kind, deps.clock.now());
    if (notReadable) return refuse(deps.log, notReadable, pageId);

    const path = photoPath(userId, pageId);
    const photo = await photoRefusal(reader.pages, path);
    if ("refusal" in photo) {
      if (reader.kind === "scheduler") {
        await deps.server.abandonQueued(userId, pageId);
        deps.log.event("page_abandoned", { pageId, code: photo.refusal.code });
      }
      return refuse(deps.log, photo.refusal, pageId);
    }

    const charge = await deps.server.charge(pageId);
    const refused = refusalForCharge(charge.reason);
    if (refused) return refuse(deps.log, refused, pageId);
    deps.log.event("charged", { pageId, code: charge.reason });
    await deps.server.recordOriginalImage(userId, pageId, path);

    if (!(await deps.server.claimForReading(userId, pageId, claimExpectation(page, deps.clock.now())))) {
      return refuse(deps.log, { status: 409, code: "page_processing" }, pageId);
    }
    if (page.status === "failed") deps.log.event("manual_relaunch", { pageId });

    let readingA: ReadingA | null = null;
    try {
      if (deps.service) readingA = startReadingA({ ...deps, service: deps.service }, userId, pageId, photo.image);
      return await readB1(deps, userId, page, photo.image, readingA);
    } finally {
      readingA?.cancel("b1_failed");
    }
  } catch (error) {
    return failed(deps.log, error);
  }
}

async function readB1(deps: ReadingDeps, userId: string, page: PageRow, image: Uint8Array, readingA: ReadingA | null): Promise<Response> {
  const first = attemptReading(deps, page.id, image, "B1");
  const second = startSecondPass(deps, page.id, image);
  try {
    return await storeFirst(deps, userId, page, await first, readingA, second);
  } finally {
    second.cancel();
  }
}

async function storeFirst(
  deps: ReadingDeps,
  userId: string,
  page: PageRow,
  done: Attempt,
  readingA: ReadingA | null,
  second: SecondPass,
): Promise<Response> {
  if (!done) return await queueForRetry(deps, userId, page);
  const pageType = pageTypeOf(done.reading.text);
  try {
    await storeReading(deps, userId, page.id, done, pageType);
  } catch (error) {
    deps.log.event("unexpected_error", { errorName: errorName(error) });
    return await queueForRetry(deps, userId, page);
  }
  if (pageType === "unsupported_script") second.cancel();
  else {
    const b2 = second.keep(userId);
    if (pageType === "text") readingA?.finish(done.reading.text, b2);
  }
  if (pageType !== "text") readingA?.cancel(pageType);
  return json(200, { status: "read" });
}
