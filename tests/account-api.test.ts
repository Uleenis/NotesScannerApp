import {
  completeTransfer,
  confirmSignIn,
  confirmSignUp,
  deleteAccount,
  signOut,
  startSignIn,
  startSignUp,
  type AccountDeps,
  type PendingTransfer,
} from "@/auth/account";
import { failureFor, isEmailAddress } from "@/auth/account-errors";

type Outcome = { error: unknown };

type Verified = {
  data: { session: { access_token: string; refresh_token: string; user: { id: string } } | null };
  error: unknown;
};

const OK: Outcome = { error: null };

const FOUND: Verified = {
  data: { session: { access_token: "found-access", refresh_token: "found-refresh", user: { id: "found-user" } } },
  error: null,
};

const PENDING: PendingTransfer = {
  pages: 2,
  session: { accessToken: "found-access", refreshToken: "found-refresh", userId: "found-user" },
};

function authError(code: string, status = 422, name = "AuthApiError"): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status, name });
}

function functionError(status: number): Error {
  return Object.assign(new Error("failed"), { name: "FunctionsHttpError", context: { status } });
}

function fakeDeps() {
  const getSession = jest.fn(async () => ({ data: { session: { access_token: "anonymous-access" } }, error: null as unknown }));
  const getUser = jest.fn(async (): Promise<Outcome> => OK);
  const updateUser = jest.fn(async (_attributes: { email: string }): Promise<Outcome> => OK);
  const signInWithOtp = jest.fn(async (_credentials: { email: string; options: { shouldCreateUser: false } }): Promise<Outcome> => OK);
  const verifyOtp = jest.fn(async (_params: { email: string; token: string; type: "email" | "email_change" }): Promise<Outcome> => OK);
  const setSession = jest.fn(async (_tokens: { access_token: string; refresh_token: string }): Promise<Outcome> => OK);
  const signOutCall = jest.fn(async (_options: { scope: "local" }): Promise<Outcome> => OK);
  const invoke = jest.fn(async (_name: string, _options?: { headers: Record<string, string> }): Promise<Outcome> => OK);
  const verifyWithoutSession = jest.fn(async (_params: { email: string; token: string; type: "email" }): Promise<Verified> => FOUND);
  const countPages = jest.fn(async () => 0);
  const deps: AccountDeps = {
    auth: { getSession, getUser, updateUser, signInWithOtp, verifyOtp, setSession, signOut: signOutCall },
    stateless: { verifyOtp: verifyWithoutSession },
    functions: { invoke },
    countPages,
  };
  return {
    deps,
    getSession,
    getUser,
    updateUser,
    signInWithOtp,
    verifyOtp,
    setSession,
    signOut: signOutCall,
    invoke,
    verifyWithoutSession,
    countPages,
  };
}

describe("starting a sign-up", () => {
  test("asks for a code by giving the clean e-mail to the anonymous account", async () => {
    const { deps, updateUser } = fakeDeps();

    expect(await startSignUp(deps, "  Reader@Example.TEST ")).toEqual({ ok: true });

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ email: "reader@example.test" });
  });

  test.each(["", "   ", "reader", "reader@", "@example.test", "reader@example", "rea der@example.test"])(
    "refuses %p without calling the server",
    async (email) => {
      const { deps, updateUser } = fakeDeps();

      expect(await startSignUp(deps, email)).toEqual({ ok: false, reason: "invalid_email" });
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  test("says that the address already has an account", async () => {
    const { deps, updateUser } = fakeDeps();
    updateUser.mockResolvedValue({ error: authError("email_exists") });

    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: false, reason: "exists" });
  });

  test("says when too many codes were asked for", async () => {
    const { deps, updateUser } = fakeDeps();
    updateUser.mockResolvedValue({ error: authError("over_email_send_rate_limit", 429) });

    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: false, reason: "too_many" });
  });

  test("says when the network is down, whether the call fails or throws", async () => {
    const { deps, updateUser } = fakeDeps();
    updateUser.mockResolvedValueOnce({ error: authError("", 0, "AuthRetryableFetchError") });
    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: false, reason: "offline" });

    updateUser.mockRejectedValueOnce(new TypeError("Network request failed"));
    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: false, reason: "offline" });
  });

  test("answers a plain failure for anything else", async () => {
    const { deps, updateUser } = fakeDeps();
    updateUser.mockResolvedValue({ error: authError("unexpected_failure", 500) });

    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: false, reason: "failed" });
  });
});

describe("starting a sign-in", () => {
  test("asks for a code without ever creating an account", async () => {
    const { deps, signInWithOtp } = fakeDeps();

    expect(await startSignIn(deps, " Reader@Example.test")).toEqual({ ok: true });

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "reader@example.test", options: { shouldCreateUser: false } });
  });

  test("refuses an invalid address without calling the server", async () => {
    const { deps, signInWithOtp } = fakeDeps();

    expect(await startSignIn(deps, "reader")).toEqual({ ok: false, reason: "invalid_email" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("says that no account has this address", async () => {
    const { deps, signInWithOtp } = fakeDeps();
    signInWithOtp.mockResolvedValue({ error: authError("otp_disabled") });

    expect(await startSignIn(deps, "reader@example.test")).toEqual({ ok: false, reason: "unknown_account" });
  });

  test("says when too many codes were asked for", async () => {
    const { deps, signInWithOtp } = fakeDeps();
    signInWithOtp.mockResolvedValue({ error: authError("over_email_send_rate_limit", 429) });

    expect(await startSignIn(deps, "reader@example.test")).toEqual({ ok: false, reason: "too_many" });
  });

  test("never refuses because of the pages of this phone and never counts them", async () => {
    const { deps, signInWithOtp, countPages } = fakeDeps();
    countPages.mockResolvedValue(4);

    expect(await startSignIn(deps, "reader@example.test")).toEqual({ ok: true });

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(countPages).not.toHaveBeenCalled();
  });

  test("a sign-up is never refused because of pages: they stay with the account", async () => {
    const { deps, countPages, updateUser } = fakeDeps();
    countPages.mockResolvedValue(5);

    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(countPages).not.toHaveBeenCalled();
  });
});

describe("confirming with the code", () => {
  test("a sign-up checks the code as the change of e-mail of the account", async () => {
    const { deps, verifyOtp } = fakeDeps();

    expect(await confirmSignUp(deps, " Reader@Example.test ", "123456")).toEqual({ ok: true });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email_change" });
  });

  test("a sign-in from a registered account checks the code as an e-mail code with the account of the phone and counts nothing", async () => {
    const { deps, verifyOtp, verifyWithoutSession, countPages } = fakeDeps();

    expect(await confirmSignIn(deps, "reader@example.test", "123456", false)).toEqual({ ok: true, transfer: null });

    expect(verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
    expect(verifyWithoutSession).not.toHaveBeenCalled();
    expect(countPages).not.toHaveBeenCalled();
  });

  test("a wrong or expired code is said to be wrong", async () => {
    const { deps, verifyOtp } = fakeDeps();
    verifyOtp.mockResolvedValue({ error: authError("otp_expired", 403) });

    expect(await confirmSignUp(deps, "reader@example.test", "000000")).toEqual({ ok: false, reason: "wrong_code" });
    expect(await confirmSignIn(deps, "reader@example.test", "000000", false)).toEqual({ ok: false, reason: "wrong_code" });
  });

  test("a code that is not six digits is wrong without calling the server or counting the pages", async () => {
    const { deps, verifyOtp, verifyWithoutSession, countPages } = fakeDeps();

    for (const code of ["", "12345", "1234567", "12345a", "12 345"]) {
      expect(await confirmSignUp(deps, "reader@example.test", code)).toEqual({ ok: false, reason: "wrong_code" });
      expect(await confirmSignIn(deps, "reader@example.test", code, false)).toEqual({ ok: false, reason: "wrong_code" });
      expect(await confirmSignIn(deps, "reader@example.test", code, true)).toEqual({ ok: false, reason: "wrong_code" });
    }
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(verifyWithoutSession).not.toHaveBeenCalled();
    expect(countPages).not.toHaveBeenCalled();
  });
});

describe("confirming a sign-in from an anonymous account", () => {
  test("without pages, checks the code with the account of the phone: it has nothing to bring", async () => {
    const { deps, verifyOtp, verifyWithoutSession, countPages } = fakeDeps();
    countPages.mockResolvedValue(0);

    expect(await confirmSignIn(deps, "reader@example.test", "123456", true)).toEqual({ ok: true, transfer: null });

    expect(verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
    expect(verifyWithoutSession).not.toHaveBeenCalled();
  });

  test("with pages, checks the code without touching the account of the phone and hands over what the transfer needs", async () => {
    const { deps, verifyOtp, verifyWithoutSession, setSession, invoke, countPages } = fakeDeps();
    countPages.mockResolvedValue(2);

    const result = await confirmSignIn(deps, " Reader@Example.test ", "123456", true);

    expect(result).toEqual({ ok: true, transfer: PENDING });
    expect(verifyWithoutSession).toHaveBeenCalledTimes(1);
    expect(verifyWithoutSession).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("counts the pages before it uses the code, so a count that fails costs nothing", async () => {
    const { deps, verifyWithoutSession, verifyOtp, countPages } = fakeDeps();
    const order: string[] = [];
    countPages.mockImplementation(async () => {
      order.push("count");
      return 1;
    });
    verifyWithoutSession.mockImplementation(async () => {
      order.push("code");
      return FOUND;
    });

    await confirmSignIn(deps, "reader@example.test", "123456", true);
    expect(order).toEqual(["count", "code"]);

    countPages.mockRejectedValue(new Error("offline"));
    expect(await confirmSignIn(deps, "reader@example.test", "123456", true)).toEqual({ ok: false, reason: "failed" });
    expect(verifyWithoutSession).toHaveBeenCalledTimes(1);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  test("says that a wrong code is wrong and brings nothing", async () => {
    const { deps, verifyWithoutSession, countPages } = fakeDeps();
    countPages.mockResolvedValue(2);
    verifyWithoutSession.mockResolvedValue({ data: { session: null }, error: authError("otp_expired", 403) });

    expect(await confirmSignIn(deps, "reader@example.test", "000000", true)).toEqual({ ok: false, reason: "wrong_code" });
  });

  test("is a failure, never a pass, when the code gives no session", async () => {
    const { deps, verifyWithoutSession, countPages } = fakeDeps();
    countPages.mockResolvedValue(2);
    verifyWithoutSession.mockResolvedValue({ data: { session: null }, error: null });

    expect(await confirmSignIn(deps, "reader@example.test", "123456", true)).toEqual({ ok: false, reason: "failed" });
  });

  test("says when the network is down", async () => {
    const { deps, verifyWithoutSession, countPages } = fakeDeps();
    countPages.mockResolvedValue(2);
    verifyWithoutSession.mockRejectedValue(new TypeError("Network request failed"));

    expect(await confirmSignIn(deps, "reader@example.test", "123456", true)).toEqual({ ok: false, reason: "offline" });
  });
});

describe("completing the transfer", () => {
  test("calls the transfer with the token of the account of the phone and the token of the account found", async () => {
    const { deps, invoke } = fakeDeps();

    await completeTransfer(deps, PENDING);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("transfer-account", {
      headers: { Authorization: "Bearer anonymous-access", "x-account-token": "found-access" },
    });
  });

  test("reads the token of the account of the phone again at every try", async () => {
    const { deps, getSession, invoke } = fakeDeps();
    getSession
      .mockResolvedValueOnce({ data: { session: { access_token: "first" } }, error: null })
      .mockResolvedValueOnce({ data: { session: { access_token: "second" } }, error: null });
    invoke.mockResolvedValueOnce({ error: functionError(500) });

    await completeTransfer(deps, PENDING);
    await completeTransfer(deps, PENDING);

    expect(invoke.mock.calls.map((call) => call[1]?.headers.Authorization)).toEqual(["Bearer first", "Bearer second"]);
  });

  test("takes the account found for this phone only after the transfer worked", async () => {
    const { deps, invoke, setSession } = fakeDeps();
    const order: string[] = [];
    invoke.mockImplementation(async () => {
      order.push("transfer");
      return OK;
    });
    setSession.mockImplementation(async () => {
      order.push("adopt");
      return OK;
    });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: true, userId: "found-user" });

    expect(order).toEqual(["transfer", "adopt"]);
    expect(setSession).toHaveBeenCalledWith({ access_token: "found-access", refresh_token: "found-refresh" });
  });

  test.each([
    ["a page being read", functionError(409), "reading_in_progress"],
    ["an error of the server", functionError(500), "failed"],
    ["a refusal", functionError(403), "failed"],
    ["a network that is down", Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" }), "offline"],
  ] as const)("keeps the account of the phone when the transfer fails because of %s", async (_name, error, reason) => {
    const { deps, invoke, setSession, getUser } = fakeDeps();
    invoke.mockResolvedValue({ error });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason });

    expect(setSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  test("takes the account found when the answer is 401 because the transfer already took place and the old account is gone", async () => {
    const { deps, invoke, getUser, setSession } = fakeDeps();
    invoke.mockResolvedValue({ error: functionError(401) });
    getUser.mockResolvedValue({ error: authError("user_not_found", 403) });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: true, userId: "found-user" });

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: "found-access", refresh_token: "found-refresh" });
  });

  test("keeps the account of the phone when the answer is 401 but the account still exists", async () => {
    const { deps, invoke, setSession } = fakeDeps();
    invoke.mockResolvedValue({ error: functionError(401) });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason: "failed" });

    expect(setSession).not.toHaveBeenCalled();
  });

  test("keeps the account of the phone when it cannot be checked because the network is down", async () => {
    const { deps, invoke, getUser, setSession } = fakeDeps();
    invoke.mockResolvedValue({ error: functionError(401) });
    getUser.mockResolvedValue({ error: Object.assign(new Error("offline"), { name: "AuthRetryableFetchError", status: 0 }) });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason: "failed" });

    expect(setSession).not.toHaveBeenCalled();
  });

  test("says when the account found could not be taken, and takes it at the next try without a second transfer being needed", async () => {
    const { deps, invoke, setSession, getUser } = fakeDeps();
    setSession.mockResolvedValueOnce({ error: authError("", 0, "AuthRetryableFetchError") });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason: "offline" });

    invoke.mockResolvedValue({ error: functionError(401) });
    getUser.mockResolvedValue({ error: authError("user_not_found", 403) });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: true, userId: "found-user" });
    expect(setSession).toHaveBeenCalledTimes(2);
  });

  test("fails without calling the transfer when the phone has no session", async () => {
    const { deps, getSession, invoke, setSession } = fakeDeps();
    getSession.mockResolvedValue({ data: { session: null as unknown as { access_token: string } }, error: null });

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason: "failed" });

    expect(invoke).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test("fails without taking anything when reading the session throws", async () => {
    const { deps, getSession, invoke, setSession } = fakeDeps();
    getSession.mockRejectedValue(new Error("storage failed"));

    expect(await completeTransfer(deps, PENDING)).toEqual({ ok: false, reason: "failed" });

    expect(invoke).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  test("ends the session of this phone only", async () => {
    const { deps, signOut: signOutCall } = fakeDeps();

    expect(await signOut(deps)).toEqual({ ok: true });

    expect(signOutCall).toHaveBeenCalledTimes(1);
    expect(signOutCall).toHaveBeenCalledWith({ scope: "local" });
  });

  test("says when it did not work", async () => {
    const { deps, signOut: signOutCall } = fakeDeps();
    signOutCall.mockResolvedValue({ error: authError("unexpected_failure", 500) });

    expect(await signOut(deps)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("deleting the account", () => {
  test("asks the server first, then ends the session of this phone", async () => {
    const { deps, invoke, signOut: signOutCall } = fakeDeps();
    const order: string[] = [];
    invoke.mockImplementation(async () => {
      order.push("delete");
      return OK;
    });
    signOutCall.mockImplementation(async () => {
      order.push("sign-out");
      return OK;
    });

    expect(await deleteAccount(deps)).toEqual({ ok: true });

    expect(order).toEqual(["delete", "sign-out"]);
    expect(invoke).toHaveBeenCalledWith("delete-account");
    expect(signOutCall).toHaveBeenCalledWith({ scope: "local" });
  });

  test("keeps the session when the server did not delete the account", async () => {
    const { deps, invoke, signOut: signOutCall } = fakeDeps();
    invoke.mockResolvedValue({ error: Object.assign(new Error("boom"), { name: "FunctionsHttpError" }) });

    expect(await deleteAccount(deps)).toEqual({ ok: false, reason: "failed" });
    expect(signOutCall).not.toHaveBeenCalled();
  });

  test("says when the network is down and keeps the session", async () => {
    const { deps, invoke, signOut: signOutCall } = fakeDeps();
    invoke.mockResolvedValue({ error: Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" }) });

    expect(await deleteAccount(deps)).toEqual({ ok: false, reason: "offline" });
    expect(signOutCall).not.toHaveBeenCalled();
  });

  function unauthorized(): Error {
    return Object.assign(new Error("unauthorized"), { name: "FunctionsHttpError", context: { status: 401 } });
  }

  test("is done when the server answers 401 because the account is already gone: the session ends", async () => {
    const { deps, invoke, getUser, signOut: signOutCall } = fakeDeps();
    invoke.mockResolvedValue({ error: unauthorized() });
    getUser.mockResolvedValue({ error: authError("user_not_found", 403) });

    expect(await deleteAccount(deps)).toEqual({ ok: true });

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(signOutCall).toHaveBeenCalledWith({ scope: "local" });
  });

  test("keeps the session when the server answers 401 but the account still exists", async () => {
    const { deps, invoke, signOut: signOutCall } = fakeDeps();
    invoke.mockResolvedValue({ error: unauthorized() });

    expect(await deleteAccount(deps)).toEqual({ ok: false, reason: "failed" });
    expect(signOutCall).not.toHaveBeenCalled();
  });

  test("keeps the session when the account cannot be checked because the network is down", async () => {
    const { deps, invoke, getUser, signOut: signOutCall } = fakeDeps();
    invoke.mockResolvedValue({ error: unauthorized() });
    getUser.mockResolvedValue({ error: Object.assign(new Error("offline"), { name: "AuthRetryableFetchError", status: 0 }) });

    expect(await deleteAccount(deps)).toEqual({ ok: false, reason: "failed" });
    expect(signOutCall).not.toHaveBeenCalled();
  });

  test("does not look for the account when the failure is not a 401", async () => {
    const { deps, invoke, getUser } = fakeDeps();
    invoke.mockResolvedValue({ error: Object.assign(new Error("boom"), { name: "FunctionsHttpError", context: { status: 500 } }) });

    expect(await deleteAccount(deps)).toEqual({ ok: false, reason: "failed" });
    expect(getUser).not.toHaveBeenCalled();
  });

  test("is done once the server deleted the account, even if ending the local session fails", async () => {
    const { deps, signOut: signOutCall } = fakeDeps();
    signOutCall.mockRejectedValue(new Error("storage failed"));

    expect(await deleteAccount(deps)).toEqual({ ok: true });
  });
});

describe("reading the failures", () => {
  test.each([
    ["email_exists", "exists"],
    ["otp_disabled", "unknown_account"],
    ["otp_expired", "wrong_code"],
    ["validation_failed", "invalid_email"],
    ["email_address_invalid", "invalid_email"],
    ["over_email_send_rate_limit", "too_many"],
    ["over_request_rate_limit", "too_many"],
  ])("%s means %s", (code, reason) => {
    expect(failureFor(authError(code))).toBe(reason);
  });

  test("a 429 means too many attempts whatever its code", () => {
    expect(failureFor(authError("something_new", 429))).toBe("too_many");
  });

  test("a 409 from a function means that a page is being read", () => {
    expect(failureFor(functionError(409))).toBe("reading_in_progress");
  });

  test("anything unknown is a plain failure", () => {
    expect(failureFor(authError("something_new", 500))).toBe("failed");
    expect(failureFor("strange")).toBe("failed");
    expect(failureFor(null)).toBe("failed");
  });

  test.each(["me@example.test", "a.b+c@sub.example.test"])("%s is an e-mail address", (email) => {
    expect(isEmailAddress(email)).toBe(true);
  });
});
