import { field } from "@/capture/api";
import { call, type TrainingClient } from "./api";
import type { Sheet, Template } from "./writing-test";

const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WritingClient = TrainingClient;

export type Upload = { path: string; token: string };

export type StartResult =
  | { status: "ready"; testId: string; uploads: [Upload, Upload] }
  | { status: "consent_required" | "in_progress" | "limit" | "offline" | "failed" };

export type CheckResult = "started" | "not_found" | "unavailable" | "offline" | "failed";

export type TestStatus = "pending" | "accepted" | "rejected" | "failed" | "gone";

export type TestState = { status: TestStatus; training: number | null; validation: number | null; redo: Sheet[] };

const START_REFUSALS: Record<string, "consent_required" | "in_progress" | "limit"> = {
  consent_required: "consent_required",
  test_in_progress: "in_progress",
  test_limit: "limit",
};

const STATUSES: readonly string[] = ["pending", "accepted", "rejected", "failed"];

function uploadsOf(data: unknown, testId: string): [Upload, Upload] | null {
  const sent = field(data, "uploads");
  if (!Array.isArray(sent) || sent.length !== 2) {
    return null;
  }
  const found: Upload[] = [];
  for (const [index, item] of sent.entries()) {
    const path = field(item, "path");
    const token = field(item, "token");
    if (typeof path !== "string" || typeof token !== "string" || token === "" || !path.endsWith(`/writing-tests/${testId}/${index + 1}.jpg`)) {
      return null;
    }
    found.push({ path, token });
  }
  return [found[0], found[1]];
}

export async function startWritingTest(client: WritingClient, template: Template): Promise<StartResult> {
  const answer = await call(client, "prepare-writing-test", { template });
  switch (answer.kind) {
    case "done": {
      const testId = field(answer.data, "test_id");
      if (typeof testId !== "string" || !IDENTIFIER.test(testId)) {
        return { status: "failed" };
      }
      const uploads = uploadsOf(answer.data, testId);
      return uploads === null ? { status: "failed" } : { status: "ready", testId, uploads };
    }
    case "offline":
      return { status: "offline" };
    case "refused":
      return { status: answer.code !== null && Object.hasOwn(START_REFUSALS, answer.code) ? START_REFUSALS[answer.code] : "failed" };
    default:
      return { status: "failed" };
  }
}

export async function requestCheck(client: WritingClient, testId: string): Promise<CheckResult> {
  const answer = await call(client, "check-writing-test", { test_id: testId });
  switch (answer.kind) {
    case "done":
      return field(answer.data, "checking") === true ? "started" : "failed";
    case "offline":
      return "offline";
    case "refused":
      if (answer.code === "test_not_found") {
        return "not_found";
      }
      return answer.code === "unavailable" ? "unavailable" : "failed";
    default:
      return "failed";
  }
}

function count(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 30) {
    throw new Error("writing_test");
  }
  return value;
}

export async function fetchWritingTest(client: WritingClient, testId: string): Promise<TestState> {
  const { data, error } = await client.from("writing_tests").select("status, training_lines, validation_lines, redo").eq("id", testId).maybeSingle();
  if (error) {
    throw new Error("writing_test");
  }
  if (data === null) {
    return { status: "gone", training: null, validation: null, redo: [] };
  }
  const status = field(data, "status");
  const redo = field(data, "redo");
  if (typeof status !== "string" || !STATUSES.includes(status) || !Array.isArray(redo) || !redo.every((sheet) => sheet === 1 || sheet === 2)) {
    throw new Error("writing_test");
  }
  return {
    status: status as TestStatus,
    training: count(field(data, "training_lines") ?? null),
    validation: count(field(data, "validation_lines") ?? null),
    redo: redo as Sheet[],
  };
}
