import { failureFor, isAccountGone, isEmailAddress, isUnauthorized, type Outcome } from "./account-errors";
import type { GetSessionResult } from "./session";

type Answer = { error: unknown };

export type AccountDeps = {
  auth: {
    getSession: () => Promise<GetSessionResult>;
    getUser: () => Promise<Answer>;
    updateUser: (attributes: { email: string }) => Promise<Answer>;
    signInWithOtp: (credentials: { email: string; options: { shouldCreateUser: false } }) => Promise<Answer>;
    verifyOtp: (params: { email: string; token: string; type: "email" | "email_change" }) => Promise<Answer>;
    signOut: (options: { scope: "local" }) => Promise<Answer>;
  };
  functions: { invoke: (name: string) => Promise<Answer> };
  countPages: () => Promise<number>;
};

type AnonymousSession = NonNullable<GetSessionResult["data"]["session"]>;

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

async function hasPagesToLose(deps: AccountDeps, isAnonymous: boolean): Promise<boolean> {
  return isAnonymous && (await deps.countPages()) > 0;
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

export function startSignIn(deps: AccountDeps, email: string, isAnonymous: boolean): Promise<Outcome> {
  return guarded(async () => {
    const address = clean(email);
    if (!isEmailAddress(address)) {
      return { ok: false, reason: "invalid_email" };
    }
    if (await hasPagesToLose(deps, isAnonymous)) {
      return { ok: false, reason: "has_pages" };
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
): Promise<Outcome<{ anonymousSession: AnonymousSession | null }>> {
  return guarded<{ anonymousSession: AnonymousSession | null }>(async () => {
    if (!CODE.test(code)) {
      return { ok: false, reason: "wrong_code" };
    }
    if (await hasPagesToLose(deps, isAnonymous)) {
      return { ok: false, reason: "has_pages" };
    }
    const anonymousSession = isAnonymous ? (await deps.auth.getSession()).data.session : null;
    const result = await deps.auth.verifyOtp({ email: clean(email), token: code, type: "email" });
    return result.error ? { ok: false, reason: failureFor(result.error) } : { ok: true, anonymousSession };
  });
}

export function signOut(deps: AccountDeps): Promise<Outcome> {
  return guarded(async () => answered(await deps.auth.signOut({ scope: "local" })));
}

async function alreadyDeleted(deps: AccountDeps, error: unknown): Promise<boolean> {
  if (!isUnauthorized(error)) {
    return false;
  }
  const { error: userError } = await deps.auth.getUser();
  return userError !== null && userError !== undefined && isAccountGone(userError);
}

export function deleteAccount(deps: AccountDeps): Promise<Outcome> {
  return guarded(async () => {
    const asked = await deps.functions.invoke("delete-account");
    if (asked.error && !(await alreadyDeleted(deps, asked.error))) {
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
