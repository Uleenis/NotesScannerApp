import { accountService } from "@/auth/account-service";
import type { AccountFailure } from "@/auth/account-errors";

export const OK = { ok: true } as const;

export function refused(reason: AccountFailure) {
  return { ok: false, reason } as const;
}

export function installFakeAccount() {
  const service = jest.mocked(accountService);
  service.startSignUp.mockReset().mockResolvedValue(OK);
  service.startSignIn.mockReset().mockResolvedValue(OK);
  service.confirmSignUp.mockReset().mockResolvedValue(OK);
  service.confirmSignIn.mockReset().mockResolvedValue({ ok: true, anonymousSession: null });
  service.signOut.mockReset().mockResolvedValue(OK);
  service.deleteAccount.mockReset().mockResolvedValue(OK);
  return service;
}
