import { pageService } from "@/pages/service";
import { getStatelessSupabase, getSupabase } from "@/lib/supabase";
import {
  completeTransfer,
  confirmSignIn,
  confirmSignUp,
  deleteAccount,
  signOut,
  startSignIn,
  startSignUp,
  type AccountDeps,
  type PendingTransfer,
} from "./account";

function deps(): AccountDeps {
  const client = getSupabase();
  return {
    auth: {
      getSession: () => client.auth.getSession(),
      getUser: () => client.auth.getUser(),
      updateUser: (attributes) => client.auth.updateUser(attributes),
      signInWithOtp: (credentials) => client.auth.signInWithOtp(credentials),
      verifyOtp: (params) => client.auth.verifyOtp(params),
      setSession: (tokens) => client.auth.setSession(tokens),
      signOut: (options) => client.auth.signOut(options),
    },
    stateless: { verifyOtp: (params) => getStatelessSupabase().auth.verifyOtp(params) },
    functions: { invoke: (name, options) => client.functions.invoke(name, options) },
    countPages: () => pageService.count(),
  };
}

export const accountService = {
  startSignUp: (email: string) => startSignUp(deps(), email),
  startSignIn: (email: string) => startSignIn(deps(), email),
  confirmSignUp: (email: string, code: string) => confirmSignUp(deps(), email, code),
  confirmSignIn: (email: string, code: string, isAnonymous: boolean) => confirmSignIn(deps(), email, code, isAnonymous),
  completeTransfer: (pending: PendingTransfer) => completeTransfer(deps(), pending),
  signOut: () => signOut(deps()),
  deleteAccount: () => deleteAccount(deps()),
};

export type AccountService = typeof accountService;
