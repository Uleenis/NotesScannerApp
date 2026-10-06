export type BlockReason = "monthly_limit" | "anonymous_limit" | "anonymous_daily_cap";

export type Allowance = {
  isAnonymous: boolean;
  used: number;
  max: number;
  remaining: number;
  resetsAt: string | null;
  blockedReason: BlockReason | null;
};

export type Block = { kind: "month"; max: number; resetMonth: number | null } | { kind: "trial" } | { kind: "daily" };

export type Counter = { kind: "month" | "trial"; remaining: number };

const COUNTER_FROM = 3;

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

export function resetMonth(resetsAt: string): number | null {
  const time = Date.parse(resetsAt);
  return Number.isNaN(time) ? null : new Date(time + HALF_DAY_MS).getUTCMonth();
}

export function blockFor(allowance: Allowance | null | undefined): Block | null {
  switch (allowance?.blockedReason) {
    case "monthly_limit":
      return { kind: "month", max: allowance.max, resetMonth: allowance.resetsAt === null ? null : resetMonth(allowance.resetsAt) };
    case "anonymous_limit":
      return { kind: "trial" };
    case "anonymous_daily_cap":
      return { kind: "daily" };
    default:
      return null;
  }
}

export function remainingCounter(allowance: Allowance | null | undefined): Counter | null {
  if (!allowance || allowance.blockedReason !== null) {
    return null;
  }
  if (allowance.remaining < 1 || allowance.remaining > COUNTER_FROM) {
    return null;
  }
  return { kind: allowance.isAnonymous ? "trial" : "month", remaining: allowance.remaining };
}
