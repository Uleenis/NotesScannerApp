export type AccountFailure =
  | "invalid_email"
  | "exists"
  | "unknown_account"
  | "wrong_code"
  | "too_many"
  | "reading_in_progress"
  | "offline"
  | "failed";

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: AccountFailure };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OFFLINE_NAMES = ["AuthRetryableFetchError", "FunctionsFetchError"];

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

export function isUnauthorized(error: unknown): boolean {
  return field(field(error, "context"), "status") === 401;
}

export function isAccountGone(error: unknown): boolean {
  return [401, 403, 404].includes(Number(field(error, "status")));
}

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value);
}

export function failureFor(error: unknown): AccountFailure {
  if (error instanceof TypeError || OFFLINE_NAMES.includes(String(field(error, "name")))) {
    return "offline";
  }
  if (field(field(error, "context"), "status") === 409) {
    return "reading_in_progress";
  }
  switch (field(error, "code")) {
    case "email_exists":
      return "exists";
    case "otp_disabled":
      return "unknown_account";
    case "otp_expired":
      return "wrong_code";
    case "validation_failed":
    case "email_address_invalid":
      return "invalid_email";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "too_many";
  }
  return field(error, "status") === 429 ? "too_many" : "failed";
}
