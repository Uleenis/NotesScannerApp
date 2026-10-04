import { createSessionManager } from "@/auth/session";
import { created, deferred, failed, fakeAuthClient, noSession, sessionOf } from "./fake-auth-client";

test("creates an anonymous account when no session exists", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(noSession());
  signInAnonymously.mockResolvedValue(created("new-user"));

  const result = await createSessionManager(client).ensureSession();

  expect(result).toEqual({ status: "ready", userId: "new-user" });
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
});

test("reuses the session that already exists", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValue(sessionOf("existing-user"));

  const result = await createSessionManager(client).ensureSession();

  expect(result).toEqual({ status: "ready", userId: "existing-user" });
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
    expect(result).toEqual({ status: "ready", userId: "only-user" });
  }
});

test("reads the session again once a call has finished", async () => {
  const { client, getSession, signInAnonymously } = fakeAuthClient();
  getSession.mockResolvedValueOnce(sessionOf("first-user")).mockResolvedValueOnce(noSession());
  signInAnonymously.mockResolvedValue(created("second-user"));
  const { ensureSession } = createSessionManager(client);

  expect(await ensureSession()).toEqual({ status: "ready", userId: "first-user" });
  expect(await ensureSession()).toEqual({ status: "ready", userId: "second-user" });
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
  expect(await ensureSession()).toEqual({ status: "ready", userId: "later-user" });
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
