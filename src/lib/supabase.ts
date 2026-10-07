import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

import { readSupabaseConfig } from "./config";
import { createChunkedStorage } from "./secure-session-storage";

let client: SupabaseClient | null = null;
let statelessClient: SupabaseClient | null = null;

function config() {
  return readSupabaseConfig({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getStatelessSupabase(): SupabaseClient {
  if (statelessClient === null) {
    const { url, publishableKey } = config();
    statelessClient = createClient(url, publishableKey, {
      auth: { storageKey: "code-check", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return statelessClient;
}

export function getSupabase(): SupabaseClient {
  if (client !== null) {
    return client;
  }
  const { url, publishableKey } = config();
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
