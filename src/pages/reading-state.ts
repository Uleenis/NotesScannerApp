import { parseMoment, retryMinutes } from "./dates";
import type { PageRecord } from "./pages";
import { CAPTURE_GRACE_MS, MAX_FADE_WAIT_MS, STROKE_CYCLE_MS } from "./timing";

export type ReadingView =
  | { kind: "waiting" }
  | { kind: "deferred"; minutes: number }
  | { kind: "failed" }
  | { kind: "document" };

export function readingView(page: Pick<PageRecord, "status" | "queueReason" | "attemptedAt">, now: Date): ReadingView {
  switch (page.status) {
    case "read":
      return { kind: "document" };
    case "failed":
      return { kind: "failed" };
    case "queued":
      return page.queueReason === "read_error" ? { kind: "deferred", minutes: retryMinutes(page.attemptedAt, now) } : { kind: "waiting" };
    case "processing":
      return { kind: "waiting" };
  }
}

export function startReadingDelay(page: Pick<PageRecord, "status" | "queueReason" | "uploadedAt">, now: Date): number | null {
  if (page.status !== "queued" || page.queueReason !== null) {
    return null;
  }
  const elapsed = now.getTime() - parseMoment(page.uploadedAt);
  return Number.isNaN(elapsed) || elapsed < 0 ? CAPTURE_GRACE_MS : Math.max(0, CAPTURE_GRACE_MS - elapsed);
}

export function fadeDelay(elapsedMs: number): number {
  return Math.min(MAX_FADE_WAIT_MS, STROKE_CYCLE_MS - (elapsedMs % STROKE_CYCLE_MS));
}
