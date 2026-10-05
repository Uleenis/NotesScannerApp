import { assertEquals } from "jsr:@std/assert@1";
import { refusalForAllowance, refusalForCharge, refusalForStatus } from "../_shared/refusals.ts";
import type { ChargeReason } from "../_shared/ports.ts";
import { OPEN_ALLOWANCE } from "./fakes.ts";

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
