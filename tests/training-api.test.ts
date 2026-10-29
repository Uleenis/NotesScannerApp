import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import {
  CONSENT_VERSION,
  confirmParent,
  fetchTrainingState,
  grantConsent,
  requestParent,
  revokeTraining,
  saveAge,
  type TrainingClient,
} from "@/training/api";

type Answer = { data?: unknown; error?: unknown };

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
}

function tableOf(answers: Record<string, Answer>, calls: { table: string; step: string; args: unknown[] }[]) {
  return (table: string) => {
    const answer = answers[table] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const step of ["select", "update", "insert", "eq", "is", "maybeSingle"]) {
      chain[step] = (...args: unknown[]) => {
        calls.push({ table, step, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => {
      if (answer.error instanceof Error && answer.error.message === "lost") {
        return Promise.reject(new TypeError("Network request failed")).then(resolve, reject);
      }
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(resolve, reject);
    };
    return chain;
  };
}

function setup(answers: Record<string, Answer> = {}, invoke: unknown = jest.fn()) {
  const calls: { table: string; step: string; args: unknown[] }[] = [];
  const client = { from: tableOf(answers, calls), functions: { invoke } } as unknown as TrainingClient;
  return { client, calls, invoke: invoke as jest.Mock };
}

describe("fetchTrainingState", () => {
  test("reads the birth year of the profile and the active consent of the user", async () => {
    const { client, calls } = setup({ profiles: { data: { birth_year: 2012 } }, consents: { data: { granted_by: "parent" } } });
    expect(await fetchTrainingState(client, "u1")).toEqual({ birthYear: 2012, consent: "parent" });
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: "profiles", step: "select", args: ["birth_year"] },
        { table: "profiles", step: "eq", args: ["id", "u1"] },
        { table: "consents", step: "select", args: ["granted_by"] },
        { table: "consents", step: "eq", args: ["user_id", "u1"] },
        { table: "consents", step: "eq", args: ["kind", "training"] },
        { table: "consents", step: "is", args: ["revoked_at", null] },
      ]),
    );
  });

  test("tells a user with no age and no consent", async () => {
    const { client } = setup({ profiles: { data: { birth_year: null } }, consents: { data: null } });
    expect(await fetchTrainingState(client, "u1")).toEqual({ birthYear: null, consent: "none" });
  });

  test("keeps a consent by the user apart from one by a parent", async () => {
    const { client } = setup({ profiles: { data: { birth_year: 1990 } }, consents: { data: { granted_by: "user" } } });
    expect(await fetchTrainingState(client, "u1")).toEqual({ birthYear: 1990, consent: "user" });
  });

  test("throws on a failed read, never an empty state", async () => {
    await expect(fetchTrainingState(setup({ profiles: { error: { message: "boom" } } }).client, "u1")).rejects.toBeDefined();
    await expect(fetchTrainingState(setup({ consents: { error: { message: "boom" } } }).client, "u1")).rejects.toBeDefined();
  });

  test("throws on a birth year or a consent that has an unexpected shape", async () => {
    await expect(fetchTrainingState(setup({ profiles: { data: { birth_year: "2012" } } }).client, "u1")).rejects.toBeDefined();
    await expect(fetchTrainingState(setup({ profiles: { data: { birth_year: 2012 } }, consents: { data: { granted_by: "admin" } } }).client, "u1")).rejects.toBeDefined();
  });
});

describe("saveAge", () => {
  test("writes the year and the country together to the profile of the user", async () => {
    const { client, calls } = setup();
    expect(await saveAge(client, "u1", 2012, "FR")).toEqual({ ok: true });
    expect(calls).toEqual([
      { table: "profiles", step: "update", args: [{ birth_year: 2012, country: "FR" }] },
      { table: "profiles", step: "eq", args: ["id", "u1"] },
    ]);
  });

  test.each([
    ["age_already_set", "already_set"],
    ["birth_year_out_of_range", "out_of_range"],
    ["account_not_registered", "not_registered"],
    ["age_set_on_insert", "failed"],
    ["something else", "failed"],
  ])("maps the refusal %s to %s", async (message, reason) => {
    const { client } = setup({ profiles: { error: { message } } });
    expect(await saveAge(client, "u1", 2012, "FR")).toEqual({ ok: false, reason });
  });

  test("tells a lost connection", async () => {
    const { client } = setup({ profiles: { error: new Error("lost") } });
    expect(await saveAge(client, "u1", 2012, "FR")).toEqual({ ok: false, reason: "offline" });
  });
});

describe("grantConsent", () => {
  test("inserts the kind and the version of the text and nothing else", async () => {
    const { client, calls } = setup();
    expect(await grantConsent(client)).toEqual({ ok: true });
    expect(calls).toEqual([{ table: "consents", step: "insert", args: [{ kind: "training", version: CONSENT_VERSION }] }]);
    expect(CONSENT_VERSION).toBe("training-1");
  });

  test.each([
    ["under_age", "under_age"],
    ["consent_already_active", "already_active"],
    ["age_missing", "age_missing"],
    ["account_not_registered", "not_registered"],
    ["consent_version_outdated", "failed"],
    ["something else", "failed"],
  ])("maps the refusal %s to %s", async (message, reason) => {
    const { client } = setup({ consents: { error: { message } } });
    expect(await grantConsent(client)).toEqual({ ok: false, reason });
  });

  test("tells a lost connection", async () => {
    const { client } = setup({ consents: { error: new Error("lost") } });
    expect(await grantConsent(client)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("requestParent", () => {
  test("sends the trimmed address alone and is ok when the e-mail left", async () => {
    const { client, invoke } = setup({}, jest.fn().mockResolvedValue({ data: { requested: true }, error: null }));
    expect(await requestParent(client, "  Parent@Example.test ")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("request-parent-consent", { body: { parent_email: "Parent@Example.test" } });
  });

  test("refuses an address that is not one without calling the server", async () => {
    const { client, invoke } = setup();
    expect(await requestParent(client, "not an address")).toEqual({ ok: false, reason: "invalid_email" });
    expect(await requestParent(client, "")).toEqual({ ok: false, reason: "invalid_email" });
    expect(invoke).not.toHaveBeenCalled();
  });

  test.each([
    [400, "invalid_email", "invalid_email"],
    [400, "same_email", "same_email"],
    [403, "account_not_registered", "not_registered"],
    [409, "age_missing", "age_missing"],
    [409, "not_under_age", "not_under_age"],
    [409, "consent_already_active", "already_active"],
    [429, "send_limit", "send_limit"],
    [503, "unavailable", "unavailable"],
    [502, "send_failed", "send_failed"],
    [400, "invalid_request", "failed"],
    [500, "internal_error", "failed"],
    [401, "unauthenticated", "failed"],
  ])("maps %s %s to %s", async (status, error, reason) => {
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: httpError(status, { error }) }));
    expect(await requestParent(client, "parent@example.test")).toEqual({ ok: false, reason });
  });

  test("a refusal whose body cannot be read is a failure", async () => {
    const broken = new FunctionsHttpError(new Response("not json", { status: 429 }));
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: broken }));
    expect(await requestParent(client, "parent@example.test")).toEqual({ ok: false, reason: "failed" });
  });

  test("a request that never reaches the server is offline, also when it throws", async () => {
    const lost = new FunctionsFetchError(new TypeError("Network request failed"));
    expect(await requestParent(setup({}, jest.fn().mockResolvedValue({ data: null, error: lost })).client, "parent@example.test")).toEqual({ ok: false, reason: "offline" });
    expect(await requestParent(setup({}, jest.fn().mockRejectedValue(new TypeError("Network request failed"))).client, "parent@example.test")).toEqual({ ok: false, reason: "offline" });
  });

  test("an answer that is neither a request nor an error is a failure", async () => {
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: { requested: false }, error: null }));
    expect(await requestParent(client, "parent@example.test")).toEqual({ ok: false, reason: "failed" });
  });
});

describe("confirmParent", () => {
  test("sends the six digits alone and is ok when the consent is written", async () => {
    const { client, invoke } = setup({}, jest.fn().mockResolvedValue({ data: { confirmed: true }, error: null }));
    expect(await confirmParent(client, "042917")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("confirm-parent-consent", { body: { code: "042917" } });
  });

  test.each(["", "12345", "1234567", "12345a", "12 345"])("refuses the code %p without calling the server", async (code) => {
    const { client, invoke } = setup();
    expect(await confirmParent(client, code)).toEqual({ ok: false, reason: "wrong_code", attemptsLeft: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  test("tells a wrong code with the attempts left", async () => {
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: httpError(400, { error: "wrong_code", attempts_left: 3 }) }));
    expect(await confirmParent(client, "042917")).toEqual({ ok: false, reason: "wrong_code", attemptsLeft: 3 });
  });

  test("keeps no attempts when the number is not one of 0 to 4", async () => {
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: httpError(400, { error: "wrong_code", attempts_left: "many" }) }));
    expect(await confirmParent(client, "042917")).toEqual({ ok: false, reason: "wrong_code", attemptsLeft: null });
  });

  test.each([
    [410, "code_expired", "expired"],
    [404, "no_request", "no_request"],
    [409, "not_under_age", "not_under_age"],
    [409, "consent_already_active", "already_active"],
    [409, "age_missing", "age_missing"],
    [403, "account_not_registered", "not_registered"],
    [409, "consent_version_outdated", "failed"],
    [400, "invalid_code", "wrong_code"],
    [400, "invalid_request", "failed"],
    [500, "internal_error", "failed"],
  ])("maps %s %s to %s", async (status, error, reason) => {
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: httpError(status, { error }) }));
    expect(await confirmParent(client, "042917")).toEqual({ ok: false, reason, attemptsLeft: null });
  });

  test("tells a lost connection", async () => {
    const lost = new FunctionsFetchError(new TypeError("Network request failed"));
    const { client } = setup({}, jest.fn().mockResolvedValue({ data: null, error: lost }));
    expect(await confirmParent(client, "042917")).toEqual({ ok: false, reason: "offline", attemptsLeft: null });
  });
});

describe("revokeTraining", () => {
  test("calls the function with no body and is ok when it answers revoked", async () => {
    const { client, invoke } = setup({}, jest.fn().mockResolvedValue({ data: { revoked: true }, error: null }));
    expect(await revokeTraining(client)).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("revoke-training");
  });

  test("a refusal or an unexpected answer is a failure, a lost connection is offline", async () => {
    expect(await revokeTraining(setup({}, jest.fn().mockResolvedValue({ data: null, error: httpError(500, { error: "internal_error" }) })).client)).toEqual({ ok: false, reason: "failed" });
    expect(await revokeTraining(setup({}, jest.fn().mockResolvedValue({ data: {}, error: null })).client)).toEqual({ ok: false, reason: "failed" });
    const lost = new FunctionsFetchError(new TypeError("Network request failed"));
    expect(await revokeTraining(setup({}, jest.fn().mockResolvedValue({ data: null, error: lost })).client)).toEqual({ ok: false, reason: "offline" });
    expect(await revokeTraining(setup({}, jest.fn().mockRejectedValue(new TypeError("Network request failed"))).client)).toEqual({ ok: false, reason: "offline" });
  });
});
