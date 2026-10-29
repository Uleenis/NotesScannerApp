import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { fetchWritingTest, requestCheck, startWritingTest, type WritingClient } from "@/training/writing-api";

const TEST_ID = "5e5e5e5e-0000-4000-8000-000000000001";
const USER = "11111111-1111-4111-8111-111111111111";

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

function uploads(testId: string = TEST_ID) {
  return [
    { path: `${USER}/writing-tests/${testId}/1.jpg`, token: "token-1" },
    { path: `${USER}/writing-tests/${testId}/2.jpg`, token: "token-2" },
  ];
}

function setup(invoke: unknown = jest.fn(), row: { data?: unknown; error?: unknown } = {}) {
  const calls: { step: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "eq"]) {
    chain[step] = (...args: unknown[]) => {
      calls.push({ step, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve({ data: row.data ?? null, error: row.error ?? null });
  const from = jest.fn(() => chain);
  const client = { functions: { invoke }, from } as unknown as WritingClient;
  return { client, calls, from, invoke: invoke as jest.Mock };
}

describe("startWritingTest", () => {
  test("asks for a test in the template given and returns its id and its two uploads", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { test_id: TEST_ID, uploads: uploads() }, error: null });
    const { client } = setup(invoke);
    expect(await startWritingTest(client, "fr")).toEqual({ status: "ready", testId: TEST_ID, uploads: uploads() });
    expect(invoke).toHaveBeenCalledWith("prepare-writing-test", { body: { template: "fr" } });
  });

  test.each([
    ["consent_required", "consent_required"],
    ["test_in_progress", "in_progress"],
    ["test_limit", "limit"],
    ["something_new", "failed"],
  ])("maps the refusal %s to %s", async (code, status) => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: httpError(409, { error: code }) });
    expect(await startWritingTest(setup(invoke).client, "en")).toEqual({ status });
  });

  test("says offline when the connection is lost", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("lost")) });
    expect(await startWritingTest(setup(invoke).client, "en")).toEqual({ status: "offline" });
    const thrown = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
    expect(await startWritingTest(setup(thrown).client, "en")).toEqual({ status: "offline" });
  });

  test.each([
    ["no id", { uploads: uploads() }],
    ["a bad id", { test_id: "nope", uploads: uploads("nope") }],
    ["one upload", { test_id: TEST_ID, uploads: uploads().slice(0, 1) }],
    ["three uploads", { test_id: TEST_ID, uploads: [...uploads(), ...uploads()] }],
    ["paths of another test", { test_id: TEST_ID, uploads: uploads("5e5e5e5e-0000-4000-8000-000000000002") }],
    ["paths in the wrong order", { test_id: TEST_ID, uploads: [...uploads()].reverse() }],
    ["a missing token", { test_id: TEST_ID, uploads: [{ path: uploads()[0].path }, uploads()[1]] }],
  ])("fails on an answer with %s", async (_name, data) => {
    const invoke = jest.fn().mockResolvedValue({ data, error: null });
    expect(await startWritingTest(setup(invoke).client, "fr")).toEqual({ status: "failed" });
  });
});

describe("requestCheck", () => {
  test("asks for the check of a test by its id alone", async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { checking: true }, error: null });
    expect(await requestCheck(setup(invoke).client, TEST_ID)).toBe("started");
    expect(invoke).toHaveBeenCalledWith("check-writing-test", { body: { test_id: TEST_ID } });
  });

  test.each([
    [404, "test_not_found", "not_found"],
    [503, "unavailable", "unavailable"],
    [500, "internal_error", "failed"],
    [400, "invalid_request", "failed"],
  ])("maps %i %s to %s", async (status, code, expected) => {
    const invoke = jest.fn().mockResolvedValue({ data: null, error: httpError(status, { error: code }) });
    expect(await requestCheck(setup(invoke).client, TEST_ID)).toBe(expected);
  });

  test("says offline when the connection is lost, and failed on an answer that is not the check starting", async () => {
    const lost = jest.fn().mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("lost")) });
    expect(await requestCheck(setup(lost).client, TEST_ID)).toBe("offline");
    const odd = jest.fn().mockResolvedValue({ data: { checking: false }, error: null });
    expect(await requestCheck(setup(odd).client, TEST_ID)).toBe("failed");
  });
});

describe("fetchWritingTest", () => {
  test("reads the test of the user by its id, with the rights of the user", async () => {
    const row = { status: "rejected", training_lines: 22, validation_lines: 8, redo: [1] };
    const { client, calls, from } = setup(jest.fn(), { data: row });
    expect(await fetchWritingTest(client, TEST_ID)).toEqual({ status: "rejected", training: 22, validation: 8, redo: [1] });
    expect(from).toHaveBeenCalledWith("writing_tests");
    expect(calls).toEqual([
      { step: "select", args: ["status, training_lines, validation_lines, redo"] },
      { step: "eq", args: ["id", TEST_ID] },
    ]);
  });

  test("tells a test still being checked and one that failed, with no counts", async () => {
    const pending = setup(jest.fn(), { data: { status: "pending", training_lines: null, validation_lines: null, redo: [] } });
    expect(await fetchWritingTest(pending.client, TEST_ID)).toEqual({ status: "pending", training: null, validation: null, redo: [] });
    const failed = setup(jest.fn(), { data: { status: "failed", training_lines: null, validation_lines: null, redo: [] } });
    expect(await fetchWritingTest(failed.client, TEST_ID)).toEqual({ status: "failed", training: null, validation: null, redo: [] });
  });

  test("tells a test that is gone", async () => {
    expect(await fetchWritingTest(setup().client, TEST_ID)).toEqual({ status: "gone", training: null, validation: null, redo: [] });
  });

  test.each([
    ["an unknown status", { status: "later", training_lines: null, validation_lines: null, redo: [] }],
    ["a sheet other than 1 or 2", { status: "rejected", training_lines: 3, validation_lines: 3, redo: [3] }],
    ["a count that is not a number", { status: "rejected", training_lines: "3", validation_lines: 3, redo: [] }],
    ["a redo that is not a list", { status: "rejected", training_lines: 3, validation_lines: 3, redo: "1" }],
  ])("throws on %s", async (_name, row) => {
    await expect(fetchWritingTest(setup(jest.fn(), { data: row }).client, TEST_ID)).rejects.toThrow();
  });

  test("throws when the read fails", async () => {
    await expect(fetchWritingTest(setup(jest.fn(), { error: { message: "boom" } }).client, TEST_ID)).rejects.toThrow();
  });
});
