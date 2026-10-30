import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

import { isEmailAddress } from "@/auth/account-errors";
import { field, looksLikeNetworkFailure } from "@/capture/api";

export const CONSENT_VERSION = "training-1";

const SIX_DIGITS = /^[0-9]{6}$/;

export type TrainingClient = Pick<SupabaseClient, "from" | "functions" | "rpc">;

type FunctionClient = Pick<SupabaseClient, "functions">;

export type TrainingState = { birthYear: number | null; consent: "none" | "user" | "parent" };

export const TRAINING_STAGES = ["not_started", "parent_pending", "test_needed", "training", "in_service", "not_precise"] as const;

export type TrainingStage = (typeof TRAINING_STAGES)[number];

type Done<Reason extends string> = { ok: true } | { ok: false; reason: Reason };

export type AgeFailure = "already_set" | "out_of_range" | "not_registered" | "offline" | "failed";
export type ConsentFailure = "under_age" | "already_active" | "age_missing" | "not_registered" | "offline" | "failed";
export type ParentRequestFailure =
  | "invalid_email"
  | "same_email"
  | "not_registered"
  | "age_missing"
  | "not_under_age"
  | "already_active"
  | "send_limit"
  | "unavailable"
  | "send_failed"
  | "offline"
  | "failed";
export type ParentConfirmFailure =
  | "wrong_code"
  | "expired"
  | "no_request"
  | "not_under_age"
  | "already_active"
  | "age_missing"
  | "not_registered"
  | "offline"
  | "failed";
export type RevokeFailure = "offline" | "failed";

export type ParentConfirmDone = { ok: true } | { ok: false; reason: ParentConfirmFailure; attemptsLeft: number | null };

export async function fetchTrainingState(client: TrainingClient, userId: string): Promise<TrainingState> {
  const [profile, consent] = await Promise.all([
    client.from("profiles").select("birth_year").eq("id", userId).maybeSingle(),
    client.from("consents").select("granted_by").eq("user_id", userId).eq("kind", "training").is("revoked_at", null).maybeSingle(),
  ]);
  if (profile.error || consent.error) {
    throw new Error("training_state");
  }
  const year = field(profile.data, "birth_year");
  if (profile.data !== null && year !== null && !Number.isInteger(year)) {
    throw new Error("training_state");
  }
  const grantedBy = field(consent.data, "granted_by");
  if (consent.data !== null && grantedBy !== "user" && grantedBy !== "parent") {
    throw new Error("training_state");
  }
  return {
    birthYear: typeof year === "number" ? year : null,
    consent: grantedBy === "user" || grantedBy === "parent" ? grantedBy : "none",
  };
}

export async function fetchTrainingStage(client: Pick<SupabaseClient, "rpc">): Promise<TrainingStage> {
  const { data, error } = await client.rpc("training_stage");
  const stage = TRAINING_STAGES.find((known) => known === data);
  if (error || stage === undefined) {
    throw new Error("training_stage");
  }
  return stage;
}

function writeFailure<Reason extends string>(error: unknown, known: Record<string, Reason>, fallback: Reason, offline: Reason): Reason {
  if (looksLikeNetworkFailure(error)) {
    return offline;
  }
  const message = field(error, "message");
  return typeof message === "string" && Object.hasOwn(known, message) ? known[message] : fallback;
}

export async function saveAge(client: TrainingClient, userId: string, birthYear: number, country: string): Promise<Done<AgeFailure>> {
  const known: Record<string, AgeFailure> = {
    age_already_set: "already_set",
    birth_year_out_of_range: "out_of_range",
    account_not_registered: "not_registered",
  };
  try {
    const { error } = await client.from("profiles").update({ birth_year: birthYear, country }).eq("id", userId);
    return error ? { ok: false, reason: writeFailure(error, known, "failed", "offline") } : { ok: true };
  } catch (error) {
    return { ok: false, reason: writeFailure(error, known, "failed", "offline") };
  }
}

export async function grantConsent(client: TrainingClient): Promise<Done<ConsentFailure>> {
  const known: Record<string, ConsentFailure> = {
    under_age: "under_age",
    consent_already_active: "already_active",
    age_missing: "age_missing",
    account_not_registered: "not_registered",
  };
  try {
    const { error } = await client.from("consents").insert({ kind: "training", version: CONSENT_VERSION });
    return error ? { ok: false, reason: writeFailure(error, known, "failed", "offline") } : { ok: true };
  } catch (error) {
    return { ok: false, reason: writeFailure(error, known, "failed", "offline") };
  }
}

export type Called = { kind: "done"; data: unknown } | { kind: "refused"; code: string | null; body: unknown } | { kind: "offline" } | { kind: "failed" };

export async function call(client: FunctionClient, name: string, body?: Record<string, string>): Promise<Called> {
  try {
    const { data, error } = body === undefined ? await client.functions.invoke(name) : await client.functions.invoke(name, { body });
    if (error instanceof FunctionsFetchError) {
      return { kind: "offline" };
    }
    if (error instanceof FunctionsHttpError) {
      let parsed: unknown = null;
      try {
        parsed = await error.context.json();
      } catch {
        parsed = null;
      }
      const code = field(parsed, "error");
      return { kind: "refused", code: typeof code === "string" ? code : null, body: parsed };
    }
    return error ? { kind: "failed" } : { kind: "done", data };
  } catch (error) {
    return looksLikeNetworkFailure(error) ? { kind: "offline" } : { kind: "failed" };
  }
}

const PARENT_REQUEST_REFUSALS: Record<string, ParentRequestFailure> = {
  invalid_email: "invalid_email",
  same_email: "same_email",
  account_not_registered: "not_registered",
  age_missing: "age_missing",
  not_under_age: "not_under_age",
  consent_already_active: "already_active",
  send_limit: "send_limit",
  unavailable: "unavailable",
  send_failed: "send_failed",
};

export async function requestParent(client: TrainingClient, email: string): Promise<Done<ParentRequestFailure>> {
  const address = email.trim();
  if (!isEmailAddress(address)) {
    return { ok: false, reason: "invalid_email" };
  }
  const answer = await call(client, "request-parent-consent", { parent_email: address });
  switch (answer.kind) {
    case "done":
      return field(answer.data, "requested") === true ? { ok: true } : { ok: false, reason: "failed" };
    case "offline":
      return { ok: false, reason: "offline" };
    case "refused":
      return {
        ok: false,
        reason: answer.code !== null && Object.hasOwn(PARENT_REQUEST_REFUSALS, answer.code) ? PARENT_REQUEST_REFUSALS[answer.code] : "failed",
      };
    default:
      return { ok: false, reason: "failed" };
  }
}

const PARENT_CONFIRM_REFUSALS: Record<string, ParentConfirmFailure> = {
  wrong_code: "wrong_code",
  invalid_code: "wrong_code",
  code_expired: "expired",
  no_request: "no_request",
  not_under_age: "not_under_age",
  consent_already_active: "already_active",
  age_missing: "age_missing",
  account_not_registered: "not_registered",
};

export async function confirmParent(client: TrainingClient, code: string): Promise<ParentConfirmDone> {
  if (!SIX_DIGITS.test(code)) {
    return { ok: false, reason: "wrong_code", attemptsLeft: null };
  }
  const answer = await call(client, "confirm-parent-consent", { code });
  switch (answer.kind) {
    case "done":
      return field(answer.data, "confirmed") === true ? { ok: true } : { ok: false, reason: "failed", attemptsLeft: null };
    case "offline":
      return { ok: false, reason: "offline", attemptsLeft: null };
    case "refused": {
      const reason = answer.code !== null && Object.hasOwn(PARENT_CONFIRM_REFUSALS, answer.code) ? PARENT_CONFIRM_REFUSALS[answer.code] : "failed";
      const left = field(answer.body, "attempts_left");
      const attemptsLeft = reason === "wrong_code" && typeof left === "number" && Number.isInteger(left) && left >= 0 && left <= 4 ? left : null;
      return { ok: false, reason, attemptsLeft };
    }
    default:
      return { ok: false, reason: "failed", attemptsLeft: null };
  }
}

export async function revokeTraining(client: TrainingClient): Promise<Done<RevokeFailure>> {
  const answer = await call(client, "revoke-training");
  switch (answer.kind) {
    case "done":
      return field(answer.data, "revoked") === true ? { ok: true } : { ok: false, reason: "failed" };
    case "offline":
      return { ok: false, reason: "offline" };
    default:
      return { ok: false, reason: "failed" };
  }
}
