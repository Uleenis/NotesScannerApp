import type { UploadResult } from "@/capture/send-page";
import type { CheckResult, StartResult, TestState, Upload } from "./writing-api";
import type { Sheet, Template } from "./writing-test";

export const POLL_MS = 3000;
export const DEADLINE_MS = 8 * 60 * 1000;

export type Resume = { testId: string; uploads: [Upload, Upload]; uploaded: [boolean, boolean]; checking: boolean };

export type RunDeps = {
  start: (template: Template) => Promise<StartResult>;
  upload: (upload: Upload, photoUri: string) => Promise<UploadResult>;
  check: (testId: string) => Promise<CheckResult>;
  read: (testId: string) => Promise<TestState>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
};

export type RunInput = { template: Template; photos: [string, string]; resume: Resume | null };

export type RunResult =
  | { status: "accepted"; training: number; validation: number }
  | { status: "rejected"; training: number; validation: number; redo: Sheet[] }
  | { status: "failed" }
  | { status: "consent_required" | "in_progress" | "limit" }
  | { status: "offline" | "photo" | "tooLarge" | "unavailable" | "timeout" | "error"; resume: Resume | null };

const UPLOAD_FAILURES = {
  tooLarge: "tooLarge",
  refused: "photo",
  network: "offline",
  failed: "error",
} as const;

async function finished(deps: RunDeps, resume: Resume): Promise<RunResult> {
  const started = deps.now();
  while (deps.now() - started < DEADLINE_MS) {
    let state: TestState | null = null;
    try {
      state = await deps.read(resume.testId);
    } catch {
      state = null;
    }
    if (state !== null && state.status !== "pending") {
      if (state.status === "failed" || state.status === "gone") {
        return { status: "failed" };
      }
      if (state.training === null || state.validation === null) {
        return { status: "error", resume };
      }
      if (state.status === "accepted") {
        return { status: "accepted", training: state.training, validation: state.validation };
      }
      return { status: "rejected", training: state.training, validation: state.validation, redo: state.redo };
    }
    await deps.wait(POLL_MS);
  }
  return { status: "timeout", resume };
}

export async function runWritingTest(deps: RunDeps, input: RunInput): Promise<RunResult> {
  let resume = input.resume;
  if (resume === null) {
    const started = await deps.start(input.template);
    if (started.status === "consent_required" || started.status === "in_progress" || started.status === "limit") {
      return { status: started.status };
    }
    if (started.status !== "ready") {
      return { status: started.status === "offline" ? "offline" : "error", resume: null };
    }
    resume = { testId: started.testId, uploads: started.uploads, uploaded: [false, false], checking: false };
  }

  for (const index of [0, 1] as const) {
    if (resume.uploaded[index]) {
      continue;
    }
    const result = await deps.upload(resume.uploads[index], input.photos[index]);
    if (result !== "uploaded") {
      return { status: UPLOAD_FAILURES[result], resume };
    }
    const uploaded: [boolean, boolean] = [...resume.uploaded];
    uploaded[index] = true;
    resume = { ...resume, uploaded };
  }

  if (!resume.checking) {
    const checked = await deps.check(resume.testId);
    if (checked === "not_found") {
      return { status: "failed" };
    }
    if (checked !== "started") {
      return { status: checked === "failed" ? "error" : checked, resume };
    }
    resume = { ...resume, checking: true };
  }
  return finished(deps, resume);
}
