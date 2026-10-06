import { blockFor, remainingCounter, resetMonth, type Allowance } from "@/capture/allowance";

function allowance(change: Partial<Allowance>): Allowance {
  return { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: "2026-10-31T23:00:00+00:00", blockedReason: null, ...change };
}

test("an allowance with no blocking reason opens the camera", () => {
  expect(blockFor(allowance({}))).toBeNull();
});

test("an unknown allowance never blocks: the server stays the only authority", () => {
  expect(blockFor(null)).toBeNull();
  expect(blockFor(undefined)).toBeNull();
});

test("the three trial pages read ask for an account", () => {
  expect(blockFor(allowance({ isAnonymous: true, used: 3, max: 3, remaining: 0, resetsAt: null, blockedReason: "anonymous_limit" }))).toEqual({
    kind: "trial",
  });
});

test("the daily cap of the anonymous accounts asks for an account with its own sentence", () => {
  expect(blockFor(allowance({ isAnonymous: true, used: 1, max: 3, remaining: 2, resetsAt: null, blockedReason: "anonymous_daily_cap" }))).toEqual({
    kind: "daily",
  });
});

test("the monthly limit is shown with the pages of the month and the month of the reset", () => {
  expect(blockFor(allowance({ used: 15, remaining: 0, blockedReason: "monthly_limit" }))).toEqual({ kind: "month", max: 15, resetMonth: 10 });
});

test("a monthly limit without a reset date is still shown, without a date", () => {
  expect(blockFor(allowance({ used: 15, remaining: 0, resetsAt: null, blockedReason: "monthly_limit" }))).toEqual({
    kind: "month",
    max: 15,
    resetMonth: null,
  });
});

test("the counter appears at three pages left or fewer, never above, never at zero", () => {
  expect(remainingCounter(allowance({ remaining: 4 }))).toBeNull();
  expect(remainingCounter(allowance({ remaining: 3 }))).toEqual({ kind: "month", remaining: 3 });
  expect(remainingCounter(allowance({ remaining: 2 }))).toEqual({ kind: "month", remaining: 2 });
  expect(remainingCounter(allowance({ remaining: 1 }))).toEqual({ kind: "month", remaining: 1 });
  expect(remainingCounter(allowance({ remaining: 0, blockedReason: "monthly_limit" }))).toBeNull();
});

test("an anonymous account counts trial pages, not pages of the month", () => {
  expect(remainingCounter(allowance({ isAnonymous: true, max: 3, remaining: 3, resetsAt: null }))).toEqual({ kind: "trial", remaining: 3 });
  expect(remainingCounter(allowance({ isAnonymous: true, max: 3, remaining: 1, resetsAt: null }))).toEqual({ kind: "trial", remaining: 1 });
});

test("there is no counter when the account is blocked, or when nothing is known", () => {
  expect(remainingCounter(allowance({ remaining: 2, blockedReason: "anonymous_daily_cap" }))).toBeNull();
  expect(remainingCounter(null)).toBeNull();
  expect(remainingCounter(undefined)).toBeNull();
});

test("the month of the reset is read in Paris time, winter and summer", () => {
  expect(resetMonth("2026-10-31T23:00:00+00:00")).toBe(10);
  expect(resetMonth("2026-06-30T22:00:00+00:00")).toBe(6);
  expect(resetMonth("2027-02-28T23:00:00+00:00")).toBe(2);
});

test("the month of the reset rolls over the year", () => {
  expect(resetMonth("2026-12-31T23:00:00+00:00")).toBe(0);
});

test("the very first instant of the new month in Paris gives the new month", () => {
  expect(resetMonth("2026-10-31T23:00:00Z")).toBe(10);
  expect(resetMonth("2026-03-31T22:00:00Z")).toBe(3);
});

test("a reset date that cannot be read gives no month", () => {
  expect(resetMonth("not a date")).toBeNull();
  expect(resetMonth("")).toBeNull();
});
