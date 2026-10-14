import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import { retryable } from "./reading-service.ts";
import type { ReadingService, ServiceFailure } from "./reading-service.ts";

const ATTEMPTS = 2;

type Clock = { now: () => number };

export type ReadingADeps = {
  service: ReadingService;
  background: (task: Promise<void>) => void;
  clock: Clock;
  log: Logger;
};

type Decision = { kind: "text"; b1: string } | { kind: "cancel"; code: string };

type Recognition = { answer: string; durationMs: number } | null;

export type ReadingA = {
  finish: (b1: string) => void;
  cancel: (code: string) => void;
};

function failureFields(failure: ServiceFailure) {
  return { kind: failure.kind, status: failure.status, code: failure.code };
}

async function recognize(deps: ReadingADeps, pageId: string, image: Uint8Array, signal: AbortSignal): Promise<Recognition> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = deps.clock.now();
    const result = await deps.service.recognize(pageId, image, signal);
    if (result.ok) return { answer: result.answer, durationMs: deps.clock.now() - started };
    if (result.failure.kind === "cancelled") return null;
    deps.log.event("recognize_attempt_failed", { pageId, attempt, ...failureFields(result.failure) });
    if (!retryable(result.failure)) return null;
  }
  return null;
}

async function arbitrate(
  deps: ReadingADeps,
  userId: string,
  pageId: string,
  b1: string,
  recognition: NonNullable<Recognition>,
  sentAt: number,
): Promise<void> {
  const signal = new AbortController().signal;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const result = await deps.service.arbitrate({ pageId, userId, b1, answer: recognition.answer, durationMs: recognition.durationMs }, signal);
    if (result.ok) {
      deps.log.event("a_done", { pageId, durationMs: deps.clock.now() - sentAt, tokens: result.tokens ?? undefined });
      return;
    }
    deps.log.event("arbitrate_attempt_failed", { pageId, attempt, ...failureFields(result.failure) });
    if (!retryable(result.failure)) {
      deps.log.event("a_abandoned", { pageId, code: result.failure.code ?? "arbitrate_refused" });
      return;
    }
  }
  deps.log.event("a_abandoned", { pageId, code: "arbitrate_failed" });
}

export function startReadingA(deps: ReadingADeps, userId: string, pageId: string, image: Uint8Array): ReadingA {
  const controller = new AbortController();
  let decide: (decision: Decision) => void = () => {};
  const decided = new Promise<Decision>((resolve) => {
    decide = resolve;
  });
  const sentAt = deps.clock.now();
  deps.log.event("a_sent", { pageId });
  const recognition = recognize(deps, pageId, image, controller.signal).catch((error: unknown): Recognition => {
    deps.log.event("unexpected_error", { errorName: errorName(error) });
    return null;
  });

  deps.background((async () => {
    try {
      const decision = await decided;
      if (decision.kind === "cancel") {
        controller.abort();
        await recognition;
        deps.log.event("a_cancelled", { pageId, code: decision.code });
        return;
      }
      const recognized = await recognition;
      if (!recognized) {
        deps.log.event("a_abandoned", { pageId, code: "recognize_failed" });
        return;
      }
      await arbitrate(deps, userId, pageId, decision.b1, recognized, sentAt);
    } catch (error) {
      controller.abort();
      deps.log.event("unexpected_error", { errorName: errorName(error) });
    }
  })());

  return {
    finish: (b1) => decide({ kind: "text", b1 }),
    cancel: (code) => decide({ kind: "cancel", code }),
  };
}
