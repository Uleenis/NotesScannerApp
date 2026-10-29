import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import { ARBITRATE_TIMEOUT_MS, retryable } from "./reading-service.ts";
import type { ReadingService, ServiceFailure } from "./reading-service.ts";

const ATTEMPTS = 2;

export const A_BUDGET_MS = 140_000;

type Clock = { now: () => number };

export type ReadingADeps = {
  service: ReadingService;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  background: (task: Promise<void>) => void;
  clock: Clock;
  log: Logger;
};

type SecondText = Promise<string | null>;

type Decision = { kind: "text"; b1: string; b2: SecondText | null } | { kind: "cancel"; code: string };

type Recognition = { answer: string; durationMs: number } | null;

export type ReadingA = {
  finish: (b1: string, b2?: SecondText) => void;
  cancel: (code: string) => void;
};

function failureFields(failure: ServiceFailure) {
  return { kind: failure.kind, status: failure.status, code: failure.code };
}

function triedAgain(failure: ServiceFailure): boolean {
  return retryable(failure) && failure.kind !== "timeout";
}

async function recognize(deps: ReadingADeps, userId: string, pageId: string, image: Uint8Array, signal: AbortSignal, deadline: number): Promise<Recognition> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = deps.clock.now();
    if (started >= deadline) return null;
    const result = await deps.service.recognize(pageId, userId, image, signal, deadline - started);
    if (result.ok) return { answer: result.answer, durationMs: deps.clock.now() - started };
    if (result.failure.kind === "cancelled") return null;
    deps.log.event("recognize_attempt_failed", { pageId, attempt, ...failureFields(result.failure) });
    if (!triedAgain(result.failure)) return null;
  }
  return null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function secondReading(deps: ReadingADeps, pageId: string, b2: SecondText | null, deadline: number): Promise<string | null> {
  if (!b2) return null;
  const stop = new AbortController();
  try {
    const waiting = (deps.wait ?? sleep)(Math.max(0, deadline - ARBITRATE_TIMEOUT_MS - deps.clock.now()), stop.signal).then(() => undefined);
    const found = await Promise.race([b2, waiting]);
    if (found === undefined) {
      deps.log.event("b2_late", { pageId });
      return null;
    }
    return found;
  } finally {
    stop.abort();
  }
}

async function arbitrate(
  deps: ReadingADeps,
  userId: string,
  pageId: string,
  b1: string,
  b2: string | null,
  recognition: NonNullable<Recognition>,
  sentAt: number,
): Promise<void> {
  const signal = new AbortController().signal;
  const deadline = sentAt + A_BUDGET_MS;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const left = deadline - deps.clock.now();
    if (left <= 0) {
      deps.log.event("a_abandoned", { pageId, code: "out_of_time" });
      return;
    }
    const result = await deps.service.arbitrate({ pageId, userId, b1, b2, answer: recognition.answer, durationMs: recognition.durationMs }, signal, left);
    if (result.ok) {
      deps.log.event("a_done", { pageId, durationMs: deps.clock.now() - sentAt, tokens: result.tokens ?? undefined });
      return;
    }
    deps.log.event("arbitrate_attempt_failed", { pageId, attempt, ...failureFields(result.failure) });
    if (attempt > 1 && result.failure.code === "already_read") {
      deps.log.event("a_done", { pageId, durationMs: deps.clock.now() - sentAt, code: "already_read" });
      return;
    }
    if (result.failure.kind === "timeout") {
      deps.log.event("a_abandoned", { pageId, code: "arbitrate_timeout" });
      return;
    }
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
  const recognition = recognize(deps, userId, pageId, image, controller.signal, sentAt + A_BUDGET_MS).catch((error: unknown): Recognition => {
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
      const b2 = await secondReading(deps, pageId, decision.b2, sentAt + A_BUDGET_MS);
      await arbitrate(deps, userId, pageId, decision.b1, b2, recognized, sentAt);
    } catch (error) {
      controller.abort();
      deps.log.event("unexpected_error", { errorName: errorName(error) });
    }
  })());

  return {
    finish: (b1, b2) => decide({ kind: "text", b1, b2: b2 ?? null }),
    cancel: (code) => decide({ kind: "cancel", code }),
  };
}
