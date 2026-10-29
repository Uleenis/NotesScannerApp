import { admitWithSecret, UUID } from "./http.ts";
import type { Logger } from "./log.ts";
import type { TrainingMeasures, TrainingReport } from "./ports.ts";

export const TRAINING_SECRET_HEADER = "x-training-secret";
export const SIGNED_URL_SECONDS = 3600;

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CER = 10;
const MEASURE_KEYS = ["task_id", "outcome", "cer", "base_cer", "faults", "base_faults", "alphabet", "samples", "sha256"];

export function admitTraining(request: Request, secret: string, log: Logger): Promise<Record<string, unknown> | Response> {
  return admitWithSecret(request, TRAINING_SECRET_HEADER, secret, log);
}

function hasExactly(body: Record<string, unknown>, keys: readonly string[]): boolean {
  const given = Object.keys(body);
  return given.length === keys.length && keys.every((key) => Object.hasOwn(body, key));
}

export function taskIdOf(body: Record<string, unknown>): string | null {
  if (!hasExactly(body, ["task_id"])) return null;
  const taskId = body.task_id;
  return typeof taskId === "string" && UUID.test(taskId) ? taskId.toLowerCase() : null;
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_CER ? value : null;
}

function count(value: unknown, low: number, high: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high ? value : null;
}

export function reportOf(body: Record<string, unknown>): { taskId: string; report: TrainingReport } | null {
  const taskId = body.task_id;
  if (typeof taskId !== "string" || !UUID.test(taskId)) return null;
  if (body.outcome === "failed") {
    return hasExactly(body, ["task_id", "outcome"]) ? { taskId: taskId.toLowerCase(), report: { outcome: "failed" } } : null;
  }
  if (body.outcome !== "trained" || !hasExactly(body, MEASURE_KEYS)) return null;
  const measures = {
    cer: rate(body.cer),
    baseCer: rate(body.base_cer),
    faults: count(body.faults, 0, 8),
    baseFaults: count(body.base_faults, 0, 8),
    alphabet: count(body.alphabet, 1, 10_000),
    samples: count(body.samples, 1, 20_000),
    sha256: typeof body.sha256 === "string" && SHA256.test(body.sha256) ? body.sha256 : null,
  };
  if (Object.values(measures).some((value) => value === null)) return null;
  return { taskId: taskId.toLowerCase(), report: { outcome: "trained", measures: measures as TrainingMeasures } };
}
