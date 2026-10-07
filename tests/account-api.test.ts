import {
  confirmSignIn,
  confirmSignUp,
  deleteAccount,
  signOut,
  startSignIn,
  startSignUp,
  type AccountDeps,
} from "@/auth/account";
import { failureFor, isEmailAddress } from "@/auth/account-errors";
import { sessionOf } from "./fake-auth-client";

type Outcome = { error: unknown };

const OK: Outcome = { error: null };

function authError(code: string, status = 422, name = "AuthApiError"): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status, name });
}

function fakeDeps() {
  const getSession = jest.fn(async () => sessionOf("anonymous-user"));
  const updateUser = jest.fn(async (_attributes: { email: string }): Promise<Outcome> => OK);
  const signInWithOtp = jest.fn(async (_credentials: { email: string; options: { shouldCreateUser: false } }): Promise<Outcome> => OK);
  const verifyOtp = jest.fn(async (_params: { email: string; token: string; type: "email" | "email_change" }): Promise<Outcome> => OK);
  const signOutCall = jest.fn(async (_options: { scope: "local" }): Promise<Outcome> => OK);
  const invoke = jest.fn(async (_name: string): Promise<Outcome> => OK);
  const countPages = jest.fn(async () => 0);
  const deps: AccountDeps = {
    auth: { getSession, updateUser, signInWithOtp, verifyOtp, signOut: signOutCall },
    functions: { invoke },
    countPages,
  };
  return { deps, getSession, updateUser, signInWithOtp, verifyOtp, signOut: signOutCall, invoke, countPages };
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

    expect(await startSignIn(deps, " Reader@Example.test", false)).toEqual({ ok: true });

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "reader@example.test", options: { shouldCreateUser: false } });
  });

  test("refuses an invalid address without calling the server", async () => {
    const { deps, signInWithOtp } = fakeDeps();

    expect(await startSignIn(deps, "reader", false)).toEqual({ ok: false, reason: "invalid_email" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("says that no account has this address", async () => {
    const { deps, signInWithOtp } = fakeDeps();
    signInWithOtp.mockResolvedValue({ error: authError("otp_disabled") });

    expect(await startSignIn(deps, "reader@example.test", false)).toEqual({ ok: false, reason: "unknown_account" });
  });

  test("says when too many codes were asked for", async () => {
    const { deps, signInWithOtp } = fakeDeps();
    signInWithOtp.mockResolvedValue({ error: authError("over_email_send_rate_limit", 429) });

    expect(await startSignIn(deps, "reader@example.test", false)).toEqual({ ok: false, reason: "too_many" });
  });
});

describe("the pages of a phone without an account", () => {
  test("a sign-in from an anonymous account that has pages is refused before any code is sent", async () => {
    const { deps, signInWithOtp, countPages } = fakeDeps();
    countPages.mockResolvedValue(2);

    expect(await startSignIn(deps, "reader@example.test", true)).toEqual({ ok: false, reason: "has_pages" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("a sign-in from an anonymous account without pages is allowed", async () => {
    const { deps, signInWithOtp, countPages } = fakeDeps();
    countPages.mockResolvedValue(0);

    expect(await startSignIn(deps, "reader@example.test", true)).toEqual({ ok: true });
    expect(countPages).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  test("a sign-in from a registered account does not count pages", async () => {
    const { deps, countPages } = fakeDeps();

    await startSignIn(deps, "reader@example.test", false);

    expect(countPages).not.toHaveBeenCalled();
  });

  test("a sign-up is never refused because of pages: they stay with the account", async () => {
    const { deps, countPages, updateUser } = fakeDeps();
    countPages.mockResolvedValue(5);

    expect(await startSignUp(deps, "reader@example.test")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(countPages).not.toHaveBeenCalled();
  });

  test("a sign-in is refused when the pages cannot be counted: nothing is risked", async () => {
    const { deps, signInWithOtp, countPages } = fakeDeps();
    countPages.mockRejectedValue(new Error("offline"));

    expect(await startSignIn(deps, "reader@example.test", true)).toEqual({ ok: false, reason: "failed" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  test("the code is refused when pages arrived since the code was asked for", async () => {
    const { deps, verifyOtp, countPages } = fakeDeps();
    countPages.mockResolvedValue(1);

    expect(await confirmSignIn(deps, "reader@example.test", "123456", true)).toEqual({ ok: false, reason: "has_pages" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("confirming with the code", () => {
  test("a sign-up checks the code as the change of e-mail of the account", async () => {
    const { deps, verifyOtp } = fakeDeps();

    expect(await confirmSignUp(deps, " Reader@Example.test ", "123456")).toEqual({ ok: true });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email_change" });
  });

  test("a sign-in checks the code as an e-mail code", async () => {
    const { deps, verifyOtp } = fakeDeps();

    const result = await confirmSignIn(deps, "reader@example.test", "123456", false);

    expect(result.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ email: "reader@example.test", token: "123456", type: "email" });
  });

  test("a wrong or expired code is said to be wrong", async () => {
    const { deps, verifyOtp } = fakeDeps();
    verifyOtp.mockResolvedValue({ error: authError("otp_expired", 403) });

    expect(await confirmSignUp(deps, "reader@example.test", "000000")).toEqual({ ok: false, reason: "wrong_code" });
    expect(await confirmSignIn(deps, "reader@example.test", "000000", false)).toEqual({ ok: false, reason: "wrong_code" });
  });

  test("a code that is not six digits is wrong without calling the server", async () => {
    const { deps, verifyOtp } = fakeDeps();

    for (const code of ["", "12345", "1234567", "12345a", "12 345"]) {
      expect(await confirmSignUp(deps, "reader@example.test", code)).toEqual({ ok: false, reason: "wrong_code" });
      expect(await confirmSignIn(deps, "reader@example.test", code, false)).toEqual({ ok: false, reason: "wrong_code" });
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  test("a sign-in from an anonymous account reads the anonymous session before the code replaces it", async () => {
    const { deps, getSession, verifyOtp } = fakeDeps();
    const order: string[] = [];
    getSession.mockImplementation(async () => {
      order.push("session");
      return sessionOf("anonymous-user");
    });
    verifyOtp.mockImplementation(async () => {
      order.push("code");
      return OK;
    });

    const result = await confirmSignIn(deps, "reader@example.test", "123456", true);

    expect(order).toEqual(["session", "code"]);
    expect(result).toEqual({ ok: true, anonymousSession: { user: expect.objectContaining({ id: "anonymous-user" }) } });
  });

  test("a sign-in from a registered account has no anonymous session to keep", async () => {
    const { deps, getSession } = fakeDeps();

    const result = await confirmSignIn(deps, "reader@example.test", "123456", false);

    expect(result).toEqual({ ok: true, anonymousSession: null });
    expect(getSession).not.toHaveBeenCalled();
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

  test("anything unknown is a plain failure", () => {
    expect(failureFor(authError("something_new", 500))).toBe("failed");
    expect(failureFor("strange")).toBe("failed");
    expect(failureFor(null)).toBe("failed");
  });

  test.each(["me@example.test", "a.b+c@sub.example.test"])("%s is an e-mail address", (email) => {
    expect(isEmailAddress(email)).toBe(true);
  });
});
