import { isNetworkFailure } from "./account-errors";
import type { StoredAccount } from "./stored-account";

export type SessionUser = { id: string; email?: string | null; is_anonymous?: boolean };

type SessionOf = { user: SessionUser };

export type GetSessionResult = { data: { session: SessionOf | null }; error: unknown };

export type SignInResult = { data: { user: SessionUser | null; session: SessionOf | null }; error: unknown };

export type AnonymousAuthClient = {
  auth: {
    getSession: () => Promise<GetSessionResult>;
    signInAnonymously: () => Promise<SignInResult>;
  };
};

export type AccountProbe = {
  stored: () => Promise<StoredAccount | null>;
  offline: () => Promise<boolean>;
};

export type AccountUser = { userId: string; email: string | null; isAnonymous: boolean };

export type AccountChange = AccountUser | null;

export type AuthResult = ({ status: "ready"; provisional?: true } & AccountUser) | { status: "unavailable" };

const UNAVAILABLE: AuthResult = { status: "unavailable" };

const KEEPS_ACCOUNT = ["SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"];

const NO_PROBE: AccountProbe = { stored: async () => null, offline: async () => false };

type ReadAccount =
  | { kind: "session"; user: SessionUser }
  | { kind: "stored"; account: StoredAccount }
  | { kind: "none" }
  | { kind: "failed" };

export function accountUser(user: SessionUser): AccountUser {
  return { userId: user.id, email: user.email ? user.email : null, isAnonymous: user.is_anonymous !== false };
}

export function accountChange(event: string, session: SessionOf | null): AccountChange | undefined {
  if (event === "SIGNED_OUT") {
    return null;
  }
  if (KEEPS_ACCOUNT.includes(event) && session) {
    return accountUser(session.user);
  }
  return undefined;
}

async function quietly<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

function storedOn(stored: StoredAccount | null, error: unknown): ReadAccount {
  return stored !== null && isNetworkFailure(error) ? { kind: "stored", account: stored } : { kind: "failed" };
}

async function readAccount(client: AnonymousAuthClient, probe: AccountProbe): Promise<ReadAccount> {
  const stored = await quietly(probe.stored, null);
  if (stored !== null && stored.expired && (await quietly(probe.offline, false))) {
    return { kind: "stored", account: stored };
  }
  try {
    const result = await client.auth.getSession();
    if (result.error) {
      return storedOn(stored, result.error);
    }
    return result.data.session ? { kind: "session", user: result.data.session.user } : { kind: "none" };
  } catch (error) {
    return storedOn(stored, error);
  }
}

async function readOrCreate(client: AnonymousAuthClient, probe: AccountProbe): Promise<AuthResult> {
  const read = await readAccount(client, probe);
  switch (read.kind) {
    case "failed":
      return UNAVAILABLE;
    case "stored":
      return { status: "ready", userId: read.account.userId, email: null, isAnonymous: read.account.isAnonymous, provisional: true };
    case "session":
      return { status: "ready", ...accountUser(read.user) };
  }
  try {
    const created = await client.auth.signInAnonymously();
    if (created.error || !created.data.user) {
      return UNAVAILABLE;
    }
    return { status: "ready", ...accountUser(created.data.user) };
  } catch {
    return UNAVAILABLE;
  }
}

export async function signedInAccount(client: AnonymousAuthClient, probe: AccountProbe): Promise<string | null> {
  const read = await readAccount(client, probe);
  switch (read.kind) {
    case "session":
      return read.user.id;
    case "stored":
      return read.account.userId;
    default:
      return null;
  }
}

export function createSessionManager(
  client: AnonymousAuthClient,
  probe: AccountProbe = NO_PROBE,
): { ensureSession: () => Promise<AuthResult> } {
  let inFlight: Promise<AuthResult> | null = null;

  function ensureSession(): Promise<AuthResult> {
    if (inFlight === null) {
      inFlight = readOrCreate(client, probe).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return { ensureSession };
}
