import type { AnonymousAuthClient, GetSessionResult, SignInResult } from "@/auth/session";

export type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function noSession(): GetSessionResult {
  return { data: { session: null }, error: null };
}

export function sessionOf(userId: string, details: { email?: string; isAnonymous?: boolean } = {}): GetSessionResult {
  return {
    data: { session: { user: { id: userId, email: details.email, is_anonymous: details.isAnonymous ?? true } } },
    error: null,
  };
}

export function created(userId: string): SignInResult {
  return {
    data: { user: { id: userId, is_anonymous: true }, session: { user: { id: userId, is_anonymous: true } } },
    error: null,
  };
}

export function failed(): SignInResult {
  return { data: { user: null, session: null }, error: new Error("network") };
}

export function fakeAuthClient() {
  const getSession = jest.fn<Promise<GetSessionResult>, []>();
  const signInAnonymously = jest.fn<Promise<SignInResult>, []>();
  const client: AnonymousAuthClient = { auth: { getSession, signInAnonymously } };
  return { client, getSession, signInAnonymously };
}
