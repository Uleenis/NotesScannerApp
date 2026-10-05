import type { Allowance, ChargeReason, PageStatus } from "./ports.ts";

export type Refusal = { status: number; code: string };

export function refusalForCharge(reason: ChargeReason): Refusal | null {
  switch (reason) {
    case "charged":
    case "already_charged":
      return null;
    case "page_not_found":
      return { status: 404, code: "page_not_found" };
    case "monthly_limit":
    case "anonymous_limit":
    case "anonymous_daily_cap":
      return { status: 403, code: reason };
  }
}

export function refusalForAllowance(allowance: Allowance): Refusal | null {
  return allowance.blockedReason ? { status: 403, code: allowance.blockedReason } : null;
}

export function refusalForStatus(status: PageStatus): Refusal | null {
  switch (status) {
    case "queued":
      return null;
    case "processing":
      return { status: 409, code: "page_processing" };
    case "read":
      return { status: 409, code: "page_already_read" };
    case "failed":
      return { status: 409, code: "page_failed" };
  }
}
