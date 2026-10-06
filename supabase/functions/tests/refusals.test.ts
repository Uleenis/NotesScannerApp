import { assertEquals } from "jsr:@std/assert@1";
import { refusalForAllowance, refusalForCharge, refusalForReading, refusalForStatus } from "../_shared/refusals.ts";
import type { ChargeReason, PageRow } from "../_shared/ports.ts";
import { DAY_MS, OPEN_ALLOWANCE, PAGE_ID, ALICE, START_OF_TEST } from "./fakes.ts";

const CHARGE_REASONS: [ChargeReason, { status: number; code: string } | null][] = [
  ["charged", null],
  ["already_charged", null],
  ["monthly_limit", { status: 403, code: "monthly_limit" }],
  ["anonymous_limit", { status: 403, code: "anonymous_limit" }],
  ["anonymous_daily_cap", { status: 403, code: "anonymous_daily_cap" }],
  ["page_not_found", { status: 404, code: "page_not_found" }],
];

for (const [reason, expected] of CHARGE_REASONS) {
  Deno.test(`the charge reason ${reason} is translated for the app`, () => {
    assertEquals(refusalForCharge(reason), expected);
  });
}

Deno.test("an allowance with no blocking reason lets the page through", () => {
  assertEquals(refusalForAllowance(OPEN_ALLOWANCE), null);
});

for (const reason of ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"] as const) {
  Deno.test(`an allowance blocked by ${reason} is refused with the same code`, () => {
    assertEquals(refusalForAllowance({ ...OPEN_ALLOWANCE, remaining: 0, blockedReason: reason }), { status: 403, code: reason });
  });
}

Deno.test("only a queued page can be sent to reading", () => {
  assertEquals(refusalForStatus("queued"), null);
  assertEquals(refusalForStatus("processing"), { status: 409, code: "page_processing" });
  assertEquals(refusalForStatus("read"), { status: 409, code: "page_already_read" });
  assertEquals(refusalForStatus("failed"), { status: 409, code: "page_failed" });
});

function row(change: Partial<PageRow>): PageRow {
  return { id: PAGE_ID, userId: ALICE, status: "queued", queueReason: null, retryCount: 0, manualRelaunchedAt: null, ...change };
}

Deno.test("the owner can read a queued page and refuses a page in processing or already read", () => {
  assertEquals(refusalForReading(row({}), "owner", START_OF_TEST), null);
  assertEquals(refusalForReading(row({ queueReason: "read_error", retryCount: 2 }), "owner", START_OF_TEST), null);
  assertEquals(refusalForReading(row({ status: "processing" }), "owner", START_OF_TEST), { status: 409, code: "page_processing" });
  assertEquals(refusalForReading(row({ status: "read" }), "owner", START_OF_TEST), { status: 409, code: "page_already_read" });
});

Deno.test("the owner can relaunch a failed page that was never relaunched or not for a day", () => {
  const failed = row({ status: "failed", retryCount: 3 });
  assertEquals(refusalForReading(failed, "owner", START_OF_TEST), null);
  const at = (ago: number) => new Date(START_OF_TEST - ago).toISOString();
  assertEquals(refusalForReading({ ...failed, manualRelaunchedAt: at(DAY_MS) }, "owner", START_OF_TEST), null);
  assertEquals(refusalForReading({ ...failed, manualRelaunchedAt: at(DAY_MS + 1) }, "owner", START_OF_TEST), null);
  assertEquals(refusalForReading({ ...failed, manualRelaunchedAt: at(DAY_MS - 1) }, "owner", START_OF_TEST), { status: 429, code: "relaunch_too_soon" });
  assertEquals(refusalForReading({ ...failed, manualRelaunchedAt: at(0) }, "owner", START_OF_TEST), { status: 429, code: "relaunch_too_soon" });
});

Deno.test("the scheduler only takes a queued page whose cause is read_error", () => {
  assertEquals(refusalForReading(row({ queueReason: "read_error", retryCount: 1 }), "scheduler", START_OF_TEST), null);
  for (const page of [
    row({}),
    row({ queueReason: "offline" }),
    row({ status: "processing" }),
    row({ status: "read" }),
    row({ status: "failed", retryCount: 3 }),
  ]) {
    assertEquals(refusalForReading(page, "scheduler", START_OF_TEST), { status: 409, code: "page_not_relaunchable" });
  }
});
