import { runWritingTest, DEADLINE_MS, POLL_MS, type Resume, type RunDeps } from "@/training/run-writing-test";
import type { StartResult, TestState, Upload } from "@/training/writing-api";

const TEST_ID = "5e5e5e5e-0000-4000-8000-000000000001";
const UPLOADS: [Upload, Upload] = [
  { path: `u/writing-tests/${TEST_ID}/1.jpg`, token: "token-1" },
  { path: `u/writing-tests/${TEST_ID}/2.jpg`, token: "token-2" },
];
const PHOTOS: [string, string] = ["file:///one.jpg", "file:///two.jpg"];

const pending: TestState = { status: "pending", training: null, validation: null, redo: [] };
const accepted: TestState = { status: "accepted", training: 30, validation: 10, redo: [] };

function state(value: TestState): TestState {
  return value;
}

function setup(overrides: Partial<RunDeps> = {}) {
  let clock = 0;
  const calls: string[] = [];
  const waits: number[] = [];
  const deps: RunDeps = {
    start: jest.fn(async (): Promise<StartResult> => {
      calls.push("start");
      return { status: "ready", testId: TEST_ID, uploads: UPLOADS };
    }),
    upload: jest.fn(async (upload: Upload) => {
      calls.push(`upload ${upload.path.slice(-5)}`);
      return "uploaded";
    }),
    check: jest.fn(async () => {
      calls.push("check");
      return "started";
    }),
    read: jest.fn(async () => {
      calls.push("read");
      return accepted;
    }),
    wait: jest.fn(async (ms: number) => {
      waits.push(ms);
      clock += ms;
    }),
    now: () => clock,
    ...overrides,
  };
  return { deps, calls, waits };
}

describe("runWritingTest", () => {
  test("starts a test, uploads both sheets with their tokens, asks for the check and waits for the answer", async () => {
    const { deps, calls, waits } = setup({
      read: jest
        .fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(accepted),
    });
    const result = await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null });
    expect(result).toEqual({ status: "accepted", training: 30, validation: 10 });
    expect(deps.start).toHaveBeenCalledWith("fr");
    expect(deps.upload).toHaveBeenNthCalledWith(1, UPLOADS[0], PHOTOS[0]);
    expect(deps.upload).toHaveBeenNthCalledWith(2, UPLOADS[1], PHOTOS[1]);
    expect(deps.check).toHaveBeenCalledWith(TEST_ID);
    expect(calls).toEqual(["start", "upload 1.jpg", "upload 2.jpg", "check"]);
    expect(deps.read).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([POLL_MS, POLL_MS]);
  });

  test("tells the sheets to redo when the test is rejected", async () => {
    const { deps } = setup({ read: jest.fn(async () => state({ status: "rejected", training: 22, validation: 8, redo: [1] })) });
    expect(await runWritingTest(deps, { template: "en", photos: PHOTOS, resume: null })).toEqual({
      status: "rejected",
      training: 22,
      validation: 8,
      redo: [1],
    });
  });

  test("tells a check that failed on the server and a test that is gone", async () => {
    const failed = setup({ read: jest.fn(async () => state({ status: "failed", training: null, validation: null, redo: [] })) });
    expect(await runWritingTest(failed.deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status: "failed" });
    const gone = setup({ read: jest.fn(async () => state({ status: "gone", training: null, validation: null, redo: [] })) });
    expect(await runWritingTest(gone.deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status: "failed" });
  });

  test.each(["consent_required", "in_progress", "limit"] as const)("stops at the refusal %s with nothing uploaded", async (status) => {
    const { deps } = setup({ start: jest.fn(async (): Promise<StartResult> => ({ status })) });
    expect(await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.check).not.toHaveBeenCalled();
  });

  test.each(["offline", "failed"] as const)("stops when the test cannot be started (%s)", async (status) => {
    const { deps } = setup({ start: jest.fn(async (): Promise<StartResult> => ({ status })) });
    expect(await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({
      status: status === "offline" ? "offline" : "error",
      resume: null,
    });
  });

  test("keeps what was uploaded when the connection is lost, and goes on from there", async () => {
    const lost = setup({ upload: jest.fn().mockResolvedValueOnce("uploaded").mockResolvedValueOnce("network") });
    const first = await runWritingTest(lost.deps, { template: "fr", photos: PHOTOS, resume: null });
    const resume: Resume = { testId: TEST_ID, uploads: UPLOADS, uploaded: [true, false], checking: false };
    expect(first).toEqual({ status: "offline", resume });
    expect(lost.deps.check).not.toHaveBeenCalled();

    const again = setup();
    expect(await runWritingTest(again.deps, { template: "fr", photos: PHOTOS, resume })).toEqual({ status: "accepted", training: 30, validation: 10 });
    expect(again.calls).toEqual(["upload 2.jpg", "check", "read"]);
    expect(again.deps.start).not.toHaveBeenCalled();
  });

  test.each([
    ["tooLarge", "tooLarge"],
    ["refused", "photo"],
    ["failed", "error"],
  ] as const)("stops on an upload that answers %s with %s and keeps the test", async (upload, status) => {
    const { deps } = setup({ upload: jest.fn(async () => upload) });
    const result = await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null });
    expect(result).toEqual({ status, resume: { testId: TEST_ID, uploads: UPLOADS, uploaded: [false, false], checking: false } });
    expect(deps.check).not.toHaveBeenCalled();
  });

  test("keeps the uploads when the check cannot be asked for, and does not upload them again", async () => {
    const offline = setup({ check: jest.fn(async () => "offline" as const) });
    const first = await runWritingTest(offline.deps, { template: "fr", photos: PHOTOS, resume: null });
    const resume: Resume = { testId: TEST_ID, uploads: UPLOADS, uploaded: [true, true], checking: false };
    expect(first).toEqual({ status: "offline", resume });
    const unavailable = setup({ check: jest.fn(async () => "unavailable" as const) });
    expect(await runWritingTest(unavailable.deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status: "unavailable", resume });
    const again = setup();
    await runWritingTest(again.deps, { template: "fr", photos: PHOTOS, resume });
    expect(again.deps.upload).not.toHaveBeenCalled();
  });

  test("says failed when the server does not know the test any more", async () => {
    const { deps } = setup({ check: jest.fn(async () => "not_found" as const) });
    expect(await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status: "failed" });
    const other = setup({ check: jest.fn(async () => "failed" as const) });
    expect(await runWritingTest(other.deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({
      status: "error",
      resume: { testId: TEST_ID, uploads: UPLOADS, uploaded: [true, true], checking: false },
    });
  });

  test("gives up waiting after the deadline and lets the caller wait again without asking for the check again", async () => {
    const { deps, waits } = setup({ read: jest.fn(async () => pending) });
    const result = await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null });
    const resume: Resume = { testId: TEST_ID, uploads: UPLOADS, uploaded: [true, true], checking: true };
    expect(result).toEqual({ status: "timeout", resume });
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(DEADLINE_MS);
    expect(waits.length).toBe(Math.floor(DEADLINE_MS / POLL_MS));

    const again = setup();
    expect(await runWritingTest(again.deps, { template: "fr", photos: PHOTOS, resume })).toEqual({ status: "accepted", training: 30, validation: 10 });
    expect(again.deps.check).not.toHaveBeenCalled();
    expect(again.deps.upload).not.toHaveBeenCalled();
  });

  test("keeps waiting when a read of the test fails once", async () => {
    const { deps } = setup({ read: jest.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(accepted) });
    expect(await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({ status: "accepted", training: 30, validation: 10 });
  });

  test("an accepted answer without its counts is an error, not a pass", async () => {
    const { deps } = setup({ read: jest.fn(async () => state({ status: "accepted", training: null, validation: null, redo: [] })) });
    expect(await runWritingTest(deps, { template: "fr", photos: PHOTOS, resume: null })).toEqual({
      status: "error",
      resume: { testId: TEST_ID, uploads: UPLOADS, uploaded: [true, true], checking: true },
    });
  });
});
