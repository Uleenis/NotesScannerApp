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

export type AccountUser = { userId: string; email: string | null; isAnonymous: boolean };

export type AccountChange = AccountUser | null;

export type AuthResult = ({ status: "ready" } & AccountUser) | { status: "unavailable" };

const UNAVAILABLE: AuthResult = { status: "unavailable" };

const KEEPS_ACCOUNT = ["SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"];

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

async function readOrCreate(client: AnonymousAuthClient): Promise<AuthResult> {
  try {
    const stored = await client.auth.getSession();
    if (stored.error) {
      return UNAVAILABLE;
    }
    if (stored.data.session) {
      return { status: "ready", ...accountUser(stored.data.session.user) };
    }
    const created = await client.auth.signInAnonymously();
    if (created.error || !created.data.user) {
      return UNAVAILABLE;
    }
    return { status: "ready", ...accountUser(created.data.user) };
  } catch {
    return UNAVAILABLE;
  }
}

export function createSessionManager(client: AnonymousAuthClient): { ensureSession: () => Promise<AuthResult> } {
  let inFlight: Promise<AuthResult> | null = null;

  function ensureSession(): Promise<AuthResult> {
    if (inFlight === null) {
      inFlight = readOrCreate(client).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return { ensureSession };
}
