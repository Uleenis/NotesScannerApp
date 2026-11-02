import type { Allowance, BlockReason } from "@/capture/allowance";
import type { AccountStore } from "./store";
import { inWrite } from "./writes";

export type KnownLimit = { allowance: Allowance; readAt: string };

const BLOCKS: readonly string[] = ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function asAllowance(value: unknown): Allowance | null {
  if (
    !isObject(value) ||
    typeof value.isAnonymous !== "boolean" ||
    !count(value.used) ||
    !count(value.max) ||
    !count(value.remaining) ||
    (value.resetsAt !== null && (typeof value.resetsAt !== "string" || Number.isNaN(Date.parse(value.resetsAt)))) ||
    (value.blockedReason !== null && (typeof value.blockedReason !== "string" || !BLOCKS.includes(value.blockedReason)))
  ) {
    return null;
  }
  return {
    isAnonymous: value.isAnonymous,
    used: value.used,
    max: value.max,
    remaining: value.remaining,
    resetsAt: value.resetsAt,
    blockedReason: value.blockedReason as BlockReason | null,
  };
}

export async function putLimit(store: AccountStore, allowance: Allowance, readAt = new Date().toISOString()): Promise<void> {
  const data = JSON.stringify({
    isAnonymous: allowance.isAnonymous,
    used: allowance.used,
    max: allowance.max,
    remaining: allowance.remaining,
    resetsAt: allowance.resetsAt,
    blockedReason: allowance.blockedReason,
  });
  await inWrite(store, () =>
    store.database.runAsync(
      "insert into known_limit (id, data, read_at) values (1, ?, ?) on conflict (id) do update set data = excluded.data, read_at = excluded.read_at",
      [data, readAt],
    ),
  );
}

export async function readLimit(store: AccountStore): Promise<KnownLimit | null> {
  const row = await store.database.getFirstAsync<{ data: string; read_at: string }>("select data, read_at from known_limit where id = 1");
  if (row === null || Number.isNaN(Date.parse(row.read_at))) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }
  const allowance = asAllowance(parsed);
  return allowance === null ? null : { allowance, readAt: row.read_at };
}

function parisDay(moment: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(moment);
}

export function offlineAllowance(known: KnownLimit, waiting: number, now: Date): Allowance {
  const { allowance } = known;
  const reset = allowance.resetsAt !== null && now.getTime() >= Date.parse(allowance.resetsAt);
  const dayChanged = allowance.blockedReason === "anonymous_daily_cap" && parisDay(new Date(known.readAt)) !== parisDay(now);
  const base = reset ? allowance.max : allowance.remaining;
  const remaining = Math.max(0, base - Math.max(0, waiting));
  let blockedReason: BlockReason | null = reset || dayChanged ? null : allowance.blockedReason;
  if (remaining === 0 && blockedReason === null) {
    blockedReason = allowance.isAnonymous ? "anonymous_limit" : "monthly_limit";
  }
  return {
    isAnonymous: allowance.isAnonymous,
    used: Math.max(0, allowance.max - remaining),
    max: allowance.max,
    remaining,
    resetsAt: reset ? null : allowance.resetsAt,
    blockedReason,
  };
}
