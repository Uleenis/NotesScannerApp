type SessionUser = { user: { id: string } };

export type GetSessionResult = { data: { session: SessionUser | null }; error: unknown };

export type SignInResult = { data: { user: { id: string } | null; session: SessionUser | null }; error: unknown };

export type AnonymousAuthClient = {
  auth: {
    getSession: () => Promise<GetSessionResult>;
    signInAnonymously: () => Promise<SignInResult>;
  };
};

export type AuthResult = { status: "ready"; userId: string } | { status: "unavailable" };

const UNAVAILABLE: AuthResult = { status: "unavailable" };

async function readOrCreate(client: AnonymousAuthClient): Promise<AuthResult> {
  try {
    const stored = await client.auth.getSession();
    if (stored.error) {
      return UNAVAILABLE;
    }
    if (stored.data.session) {
      return { status: "ready", userId: stored.data.session.user.id };
    }
    const created = await client.auth.signInAnonymously();
    if (created.error || !created.data.user) {
      return UNAVAILABLE;
    }
    return { status: "ready", userId: created.data.user.id };
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
