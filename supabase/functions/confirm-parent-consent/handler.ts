import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { PARENT_CODE } from "../_shared/parent-consent.ts";
import type { ParentConfirmOutcome, ParentConsentDeps } from "../_shared/ports.ts";
import type { Refusal } from "../_shared/refusals.ts";

const REFUSALS: Record<Exclude<ParentConfirmOutcome, "confirmed" | "wrong_code">, Refusal> = {
  no_request: { status: 404, code: "no_request" },
  invalid_code: { status: 400, code: "invalid_code" },
  code_expired: { status: 410, code: "code_expired" },
  too_many_attempts: { status: 429, code: "too_many_attempts" },
  account_not_registered: { status: 403, code: "account_not_registered" },
  consent_version_outdated: { status: 409, code: "consent_version_outdated" },
  age_missing: { status: 409, code: "age_missing" },
  not_under_age: { status: 409, code: "not_under_age" },
  consent_already_active: { status: 409, code: "consent_already_active" },
};

async function codeFrom(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || typeof fields.code !== "string" || !PARENT_CODE.test(fields.code)) return null;
  return fields.code;
}

export async function handleConfirmParentConsent(request: Request, deps: ParentConsentDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const code = await codeFrom(request);
    if (code === null) return refuse(deps.log, { status: 400, code: "invalid_request" });

    const { outcome, attemptsLeft } = await deps.parents.confirm(entry.caller.userId, code);
    if (outcome === "wrong_code") {
      deps.log.event("refused", { code: "wrong_code", status: 400, attempt: attemptsLeft ?? undefined });
      return json(400, { error: "wrong_code", attempts_left: attemptsLeft });
    }
    if (outcome !== "confirmed") return refuse(deps.log, REFUSALS[outcome]);
    deps.log.event("parent_consent_confirmed");
    return json(200, { confirmed: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
