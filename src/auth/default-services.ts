import { getSupabase } from "@/lib/supabase";
import type { AuthServices } from "./auth-provider";
import { syncInterfaceLanguage } from "./profile-language";
import { accountChange, createSessionManager } from "./session";

let manager: ReturnType<typeof createSessionManager> | null = null;

export const defaultAuthServices: AuthServices = {
  ensureSession() {
    manager ??= createSessionManager(getSupabase());
    return manager.ensureSession();
  },
  syncLanguage(userId, language) {
    return syncInterfaceLanguage(getSupabase(), userId, language);
  },
  watch(listener) {
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      const change = accountChange(event, session);
      if (change !== undefined) {
        listener(change);
      }
    });
    return () => data.subscription.unsubscribe();
  },
};
