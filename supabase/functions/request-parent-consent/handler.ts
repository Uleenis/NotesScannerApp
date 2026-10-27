import { admitCaller, failed, json, refuse } from "../_shared/http.ts";
import { errorName } from "../_shared/log.ts";
import { isParentEmail, MailError, parentEmail } from "../_shared/parent-consent.ts";
import type { ParentConsentDeps, ParentRequestOutcome } from "../_shared/ports.ts";
import type { Refusal } from "../_shared/refusals.ts";

const REFUSALS: Record<Exclude<ParentRequestOutcome, "requested">, Refusal> = {
  account_not_registered: { status: 403, code: "account_not_registered" },
  age_missing: { status: 409, code: "age_missing" },
  not_under_age: { status: 409, code: "not_under_age" },
  consent_already_active: { status: 409, code: "consent_already_active" },
  invalid_email: { status: 400, code: "invalid_email" },
  same_email: { status: 400, code: "same_email" },
  send_limit: { status: 429, code: "send_limit" },
};

async function addressFrom(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || typeof fields.parent_email !== "string") return null;
  return fields.parent_email;
}

export async function handleRequestParentConsent(request: Request, deps: ParentConsentDeps): Promise<Response> {
  try {
    const entry = await admitCaller(request, deps.auth, deps.log);
    if (entry instanceof Response) return entry;
    const address = await addressFrom(request);
    if (address === null) return refuse(deps.log, { status: 400, code: "invalid_request" });
    if (!isParentEmail(address)) return refuse(deps.log, { status: 400, code: "invalid_email" });
    if (!deps.mailer) return refuse(deps.log, { status: 503, code: "unavailable" });

    const userId = entry.caller.userId;
    const { outcome, requestId, code } = await deps.parents.request(userId, address);
    if (outcome !== "requested") return refuse(deps.log, REFUSALS[outcome]);
    if (!requestId || !code) return failed(deps.log, new Error("request"));

    try {
      await deps.mailer.send({ to: address.toLowerCase(), ...parentEmail(code) });
    } catch (error) {
      deps.log.event("parent_email_failed", { errorName: errorName(error), status: error instanceof MailError ? error.status : undefined });
      await deps.parents.withdraw(userId, requestId);
      return json(502, { error: "send_failed" });
    }
    deps.log.event("parent_consent_requested");
    return json(200, { requested: true });
  } catch (error) {
    return failed(deps.log, error);
  }
}
