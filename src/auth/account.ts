import { failureFor, isAccountGone, isEmailAddress, isUnauthorized, type Outcome } from "./account-errors";

type Answer = { error: unknown };

type FoundSession = { access_token: string; refresh_token: string; user: { id: string } };

export type AccountDeps = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
    getUser: () => Promise<Answer>;
    updateUser: (attributes: { email: string }) => Promise<Answer>;
    signInWithOtp: (credentials: { email: string; options: { shouldCreateUser: false } }) => Promise<Answer>;
    verifyOtp: (params: { email: string; token: string; type: "email" | "email_change" }) => Promise<Answer>;
    setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<Answer>;
    signOut: (options: { scope: "local" }) => Promise<Answer>;
  };
  stateless: {
    verifyOtp: (params: { email: string; token: string; type: "email" }) => Promise<{ data: { session: FoundSession | null }; error: unknown }>;
  };
  functions: { invoke: (name: string, options?: { headers: Record<string, string> }) => Promise<Answer> };
  countPages: () => Promise<number>;
};

export type PendingTransfer = {
  pages: number;
  session: { accessToken: string; refreshToken: string; userId: string };
};

const CODE = /^\d{6}$/;

function clean(email: string): string {
  return email.trim().toLowerCase();
}

async function guarded<T extends object = object>(run: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await run();
  } catch (error) {
    return { ok: false, reason: failureFor(error) };
  }
}

function answered(result: Answer): Outcome {
  return result.error ? { ok: false, reason: failureFor(result.error) } : { ok: true };
}

export function startSignUp(deps: AccountDeps, email: string): Promise<Outcome> {
  return guarded(async () => {
    const address = clean(email);
    if (!isEmailAddress(address)) {
      return { ok: false, reason: "invalid_email" };
    }
    return answered(await deps.auth.updateUser({ email: address }));
  });
}

export function startSignIn(deps: AccountDeps, email: string): Promise<Outcome> {
  return guarded(async () => {
    const address = clean(email);
    if (!isEmailAddress(address)) {
      return { ok: false, reason: "invalid_email" };
    }
    return answered(await deps.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } }));
  });
}

export function confirmSignUp(deps: AccountDeps, email: string, code: string): Promise<Outcome> {
  return guarded(async () => {
    if (!CODE.test(code)) {
      return { ok: false, reason: "wrong_code" };
    }
    return answered(await deps.auth.verifyOtp({ email: clean(email), token: code, type: "email_change" }));
  });
}

export function confirmSignIn(
  deps: AccountDeps,
  email: string,
  code: string,
  isAnonymous: boolean,
): Promise<Outcome<{ transfer: PendingTransfer | null }>> {
  return guarded<{ transfer: PendingTransfer | null }>(async () => {
    if (!CODE.test(code)) {
      return { ok: false, reason: "wrong_code" };
    }
    const params = { email: clean(email), token: code, type: "email" as const };
    const pages = isAnonymous ? await deps.countPages() : 0;
    if (pages === 0) {
      const result = await deps.auth.verifyOtp(params);
      return result.error ? { ok: false, reason: failureFor(result.error) } : { ok: true, transfer: null };
    }
    const result = await deps.stateless.verifyOtp(params);
    if (result.error) {
      return { ok: false, reason: failureFor(result.error) };
    }
    const session = result.data.session;
    if (!session) {
      return { ok: false, reason: "failed" };
    }
    return {
      ok: true,
      transfer: { pages, session: { accessToken: session.access_token, refreshToken: session.refresh_token, userId: session.user.id } },
    };
  });
}

async function accountIsGone(deps: AccountDeps, error: unknown): Promise<boolean> {
  if (!isUnauthorized(error)) {
    return false;
  }
  const { error: userError } = await deps.auth.getUser();
  return userError !== null && userError !== undefined && isAccountGone(userError);
}

export function completeTransfer(deps: AccountDeps, pending: PendingTransfer): Promise<Outcome<{ userId: string }>> {
  return guarded<{ userId: string }>(async () => {
    const anonymous = (await deps.auth.getSession()).data.session;
    if (!anonymous) {
      return { ok: false, reason: "failed" };
    }
    const asked = await deps.functions.invoke("transfer-account", {
      headers: { Authorization: `Bearer ${anonymous.access_token}`, "x-account-token": pending.session.accessToken },
    });
    if (asked.error && !(await accountIsGone(deps, asked.error))) {
      return { ok: false, reason: failureFor(asked.error) };
    }
    const adopted = await deps.auth.setSession({
      access_token: pending.session.accessToken,
      refresh_token: pending.session.refreshToken,
    });
    return adopted.error ? { ok: false, reason: failureFor(adopted.error) } : { ok: true, userId: pending.session.userId };
  });
}

export function signOut(deps: AccountDeps): Promise<Outcome> {
  return guarded(async () => answered(await deps.auth.signOut({ scope: "local" })));
}

export function deleteAccount(deps: AccountDeps): Promise<Outcome> {
  return guarded(async () => {
    const asked = await deps.functions.invoke("delete-account");
    if (asked.error && !(await accountIsGone(deps, asked.error))) {
      return { ok: false, reason: failureFor(asked.error) };
    }
    try {
      await deps.auth.signOut({ scope: "local" });
    } catch {
      return { ok: true };
    }
    return { ok: true };
  });
}
