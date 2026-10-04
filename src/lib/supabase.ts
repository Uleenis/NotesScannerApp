import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

import { readSupabaseConfig } from "./config";
import { createChunkedStorage } from "./secure-session-storage";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client !== null) {
    return client;
  }
  const { url, publishableKey } = readSupabaseConfig({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const created = createClient(url, publishableKey, {
    auth: {
      storage: createChunkedStorage(SecureStore),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      created.auth.startAutoRefresh();
    } else {
      created.auth.stopAutoRefresh();
    }
  });
  client = created;
  return created;
}
