import { getSupabase } from "@/lib/supabase";
import type { AuthServices } from "./auth-provider";
import { syncInterfaceLanguage } from "./profile-language";
import { createSessionManager } from "./session";

let manager: ReturnType<typeof createSessionManager> | null = null;

export const defaultAuthServices: AuthServices = {
  ensureSession() {
    manager ??= createSessionManager(getSupabase());
    return manager.ensureSession();
  },
  syncLanguage(userId, language) {
    return syncInterfaceLanguage(getSupabase(), userId, language);
  },
};
