import { accountChange, createSessionManager } from "@/auth/session";
import { created, deferred, failed, fakeAuthClient, noSession, sessionOf } from "./fake-auth-client";

test("creates an anonymous account when no session exists", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValue(created("new-user"));

  const result = await createSessionManager(client).ensureSession();

  expect(result).toEqual({ status: "ready", userId: "new-user", email: null, isAnonymous: true });
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
});

test("reuses the session that already exists", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(sessionOf("existing-user"));

  const result = await createSessionManager(client).ensureSession();

  expect(result).toEqual({ status: "ready", userId: "existing-user", email: null, isAnonymous: true });
  expect(signInAnonymously).not.toHaveBeenCalled();
});

test("creates one account for several simultaneous calls", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  const sessionRead = deferred<ReturnType<typeof noSession>>();
  const signIn = deferred<ReturnType<typeof created>>();
  getSession.mockReturnValue(sessionRead.promise);
  signInAnonymously.mockReturnValue(signIn.promise);
  const { ensureSession } = createSessionManager(client);

  const calls = [ensureSession(), ensureSession(), ensureSession(), ensureSession(), ensureSession()];
  sessionRead.resolve(noSession());
  await Promise.resolve();
  signIn.resolve(created("only-user"));
  const results = await Promise.all(calls);

  expect(getSession).toHaveBeenCalledTimes(1);
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
  for (const result of results) {
    expect(result).toEqual({ status: "ready", userId: "only-user", email: null, isAnonymous: true });
  }
});

test("reads the session again once a call has finished", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValueOnce(sessionOf("first-user")).mockResolvedValueOnce(noSession());
  signInAnonymously.mockResolvedValue(created("second-user"));
  const { ensureSession } = createSessionManager(client);

  expect(await ensureSession()).toEqual({ status: "ready", userId: "first-user", email: null, isAnonymous: true });
  expect(await ensureSession()).toEqual({ status: "ready", userId: "second-user", email: null, isAnonymous: true });
  expect(getSession).toHaveBeenCalledTimes(2);
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
});

test("answers unavailable when the account cannot be created", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValue(failed());

  expect(await createSessionManager(client).ensureSession()).toEqual({ status: "unavailable" });
});

test("answers unavailable when the network call throws", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockRejectedValue(new TypeError("Network request failed"));

  expect(await createSessionManager(client).ensureSession()).toEqual({ status: "unavailable" });
});

test("tries again after a failure and succeeds", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValueOnce(failed()).mockResolvedValueOnce(created("later-user"));
  const { ensureSession } = createSessionManager(client);

  expect(await ensureSession()).toEqual({ status: "unavailable" });
  expect(await ensureSession()).toEqual({ status: "ready", userId: "later-user", email: null, isAnonymous: true });
});

test("does not create an account when the stored session cannot be read", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue({ data: { session: null }, error: new Error("refresh failed") });

  expect(await createSessionManager(client).ensureSession()).toEqual({ status: "unavailable" });
  expect(signInAnonymously).not.toHaveBeenCalled();
});

test("does not create an account when reading the session throws", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockRejectedValue(new Error("storage failed"));

  expect(await createSessionManager(client).ensureSession()).toEqual({ status: "unavailable" });
  expect(signInAnonymously).not.toHaveBeenCalled();
});

test("answers unavailable when the new account comes back without a user", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValue({ data: { user: null, session: null }, error: null });

  expect(await createSessionManager(client).ensureSession()).toEqual({ status: "unavailable" });
});

test("tells that a stored session belongs to a registered account, with its e-mail", async () => {
  const { client, getSession } = fakeAuthClient();
  getSession.mockResolvedValue(sessionOf("registered-user", { email: "reader@example.test", isAnonymous: false }));

  expect(await createSessionManager(client).ensureSession()).toEqual({
    status: "ready",
    userId: "registered-user",
    email: "reader@example.test",
    isAnonymous: false,
  });
});

test("treats a session that does not say it is registered as anonymous", async () => {
  const { client, getSession } = fakeAuthClient();
  getSession.mockResolvedValue({ data: { session: { user: { id: "unclear-user" } } }, error: null });

  expect(await createSessionManager(client).ensureSession()).toEqual({
    status: "ready",
    userId: "unclear-user",
    email: null,
    isAnonymous: true,
  });
});

test.each([
  ["SIGNED_IN", "registered-user"],
  ["USER_UPDATED", "registered-user"],
  ["TOKEN_REFRESHED", "registered-user"],
])("follows the user of a %s event", (event, userId) => {
  expect(accountChange(event, { user: { id: userId, email: "reader@example.test", is_anonymous: false } })).toEqual({
    userId,
    email: "reader@example.test",
    isAnonymous: false,
  });
});

test("follows a SIGNED_OUT event as the end of the account", () => {
  expect(accountChange("SIGNED_OUT", null)).toBeNull();
});

test.each(["INITIAL_SESSION", "PASSWORD_RECOVERY", "MFA_CHALLENGE_VERIFIED"])("ignores a %s event", (event) => {
  expect(accountChange(event, { user: { id: "someone" } })).toBeUndefined();
});

test("ignores a sign-in event that carries no session", () => {
  expect(accountChange("SIGNED_IN", null)).toBeUndefined();
});
