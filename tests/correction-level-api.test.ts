import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { fetchLevel, setLevel, type LevelClient } from "@/notebooks/level";
import { fetchTrainingStage, type TrainingClient } from "@/training/api";

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

function readerOf(answer: { data?: unknown; error?: unknown }, calls: { step: string; args: unknown[] }[]) {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "eq"]) {
    chain[step] = (...args: unknown[]) => {
      calls.push({ step, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
  return chain;
}

function levelClient(answer: { data?: unknown; error?: unknown }, invoke: unknown = jest.fn()) {
  const calls: { step: string; args: unknown[] }[] = [];
  const from = jest.fn(() => readerOf(answer, calls));
  const client = { from, functions: { invoke } } as unknown as LevelClient;
  return { client, calls, from, invoke: invoke as jest.Mock };
}

describe("fetchLevel", () => {
  test("reads the level of the notebook by its id", async () => {
    const { client, calls, from } = levelClient({ data: { correction_level: "journal" } });
    expect(await fetchLevel(client, "n1")).toBe("journal");
    expect(from).toHaveBeenCalledWith("notebooks");
    expect(calls).toEqual([
      { step: "select", args: ["correction_level"] },
      { step: "eq", args: ["id", "n1"] },
    ]);
  });

  test("a notebook that is not there has no level", async () => {
    expect(await fetchLevel(levelClient({ data: null }).client, "n1")).toBeNull();
  });

  test("a level the app does not know reads as the course level, never as a higher one", async () => {
    expect(await fetchLevel(levelClient({ data: { correction_level: "strict" } }).client, "n1")).toBe("course");
    expect(await fetchLevel(levelClient({ data: { correction_level: 3 } }).client, "n1")).toBe("course");
    expect(await fetchLevel(levelClient({ data: {} }).client, "n1")).toBe("course");
  });

  test("a read that fails is an error", async () => {
    await expect(fetchLevel(levelClient({ error: { message: "boom" } }).client, "n1")).rejects.toThrow();
  });
});

describe("setLevel", () => {
  test("calls the function with the notebook and the level alone, and is set when it answers that level", async () => {
    const { client, invoke } = levelClient({}, jest.fn().mockResolvedValue({ data: { level: "grammar" }, error: null }));
    expect(await setLevel(client, "n1", "grammar")).toEqual({ status: "set", level: "grammar" });
    expect(invoke).toHaveBeenCalledWith("set-correction-level", { body: { notebook_id: "n1", level: "grammar" } });
  });

  test("an answer for another level, or no level, is a failure", async () => {
    expect(await setLevel(levelClient({}, jest.fn().mockResolvedValue({ data: { level: "journal" }, error: null })).client, "n1", "grammar")).toEqual({ status: "failed" });
    expect(await setLevel(levelClient({}, jest.fn().mockResolvedValue({ data: {}, error: null })).client, "n1", "grammar")).toEqual({ status: "failed" });
  });

  test("the refusal that needs a model in service is told apart, and so is a notebook that is gone", async () => {
    const needs = jest.fn().mockResolvedValue({ data: null, error: httpError(409, { error: "requires_model" }) });
    expect(await setLevel(levelClient({}, needs).client, "n1", "journal")).toEqual({ status: "requires_model" });
    const gone = jest.fn().mockResolvedValue({ data: null, error: httpError(404, { error: "notebook_not_found" }) });
    expect(await setLevel(levelClient({}, gone).client, "n1", "journal")).toEqual({ status: "missing" });
  });

  test("any other refusal is a failure, a lost connection is offline", async () => {
    const other = jest.fn().mockResolvedValue({ data: null, error: httpError(500, { error: "internal_error" }) });
    expect(await setLevel(levelClient({}, other).client, "n1", "journal")).toEqual({ status: "failed" });
    const lost = new FunctionsFetchError(new TypeError("Network request failed"));
    expect(await setLevel(levelClient({}, jest.fn().mockResolvedValue({ data: null, error: lost })).client, "n1", "journal")).toEqual({ status: "offline" });
    expect(await setLevel(levelClient({}, jest.fn().mockRejectedValue(new TypeError("Network request failed"))).client, "n1", "journal")).toEqual({ status: "offline" });
  });
});

describe("fetchTrainingStage", () => {
  function stageClient(answer: { data?: unknown; error?: unknown }) {
    const rpc = jest.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
    return { client: { rpc } as unknown as TrainingClient, rpc };
  }

  test("asks the database for the stage with no argument, so it can only be the caller's", async () => {
    const { client, rpc } = stageClient({ data: "in_service" });
    expect(await fetchTrainingStage(client)).toBe("in_service");
    expect(rpc).toHaveBeenCalledWith("training_stage");
  });

  test("reads each of the six stages", async () => {
    for (const stage of ["not_started", "parent_pending", "test_needed", "training", "in_service", "not_precise"]) {
      expect(await fetchTrainingStage(stageClient({ data: stage }).client)).toBe(stage);
    }
  });

  test("a stage it does not know, or a failed call, is an error", async () => {
    await expect(fetchTrainingStage(stageClient({ data: "ready" }).client)).rejects.toThrow();
    await expect(fetchTrainingStage(stageClient({ data: null }).client)).rejects.toThrow();
    await expect(fetchTrainingStage(stageClient({ error: { message: "boom" } }).client)).rejects.toThrow();
  });
});
