import { blockForReason, type Allowance, type Block } from "@/capture/allowance";
import { limitParams, readLimitParams } from "@/capture/limit-route";

const blocks: Block[] = [
  { kind: "trial" },
  { kind: "daily" },
  { kind: "month", max: 15, resetMonth: 10 },
  { kind: "month", max: 15, resetMonth: 0 },
  { kind: "month", max: 15, resetMonth: null },
];

test.each(blocks)("a block survives the trip through the address of the sheet: %j", (block) => {
  expect(readLimitParams(limitParams(block))).toEqual(block);
});

test("an address that does not describe a block is read as none", () => {
  expect(readLimitParams({})).toBeNull();
  expect(readLimitParams({ kind: "other" as never })).toBeNull();
  expect(readLimitParams({ kind: "month" })).toBeNull();
  expect(readLimitParams({ kind: "month", max: "many" })).toBeNull();
  expect(readLimitParams({ kind: "month", max: "15", month: "x" })).toBeNull();
  expect(readLimitParams({ kind: ["trial"] })).toBeNull();
});

test("a limit refused by the server takes its details from a fresh allowance", () => {
  const fresh: Allowance = { isAnonymous: false, used: 15, max: 15, remaining: 0, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: "monthly_limit" };
  expect(blockForReason("monthly_limit", fresh)).toEqual({ kind: "month", max: 15, resetMonth: 10 });
});

test("a limit refused by the server is still shown when no fresh allowance can be read", () => {
  expect(blockForReason("monthly_limit", null)).toEqual({ kind: "month", max: 15, resetMonth: null });
  expect(blockForReason("anonymous_limit", null)).toEqual({ kind: "trial" });
  expect(blockForReason("anonymous_daily_cap", undefined)).toEqual({ kind: "daily" });
});
