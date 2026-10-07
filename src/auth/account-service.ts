import { pageService } from "@/pages/service";
import { getSupabase } from "@/lib/supabase";
import {
  confirmSignIn,
  confirmSignUp,
  deleteAccount,
  signOut,
  startSignIn,
  startSignUp,
  type AccountDeps,
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
      signOut: (options) => client.auth.signOut(options),
    },
    functions: { invoke: (name) => client.functions.invoke(name) },
    countPages: () => pageService.count(),
  };
}

export const accountService = {
  startSignUp: (email: string) => startSignUp(deps(), email),
  startSignIn: (email: string, isAnonymous: boolean) => startSignIn(deps(), email, isAnonymous),
  confirmSignUp: (email: string, code: string) => confirmSignUp(deps(), email, code),
  confirmSignIn: (email: string, code: string, isAnonymous: boolean) => confirmSignIn(deps(), email, code, isAnonymous),
  signOut: () => signOut(deps()),
  deleteAccount: () => deleteAccount(deps()),
};

export type AccountService = typeof accountService;
