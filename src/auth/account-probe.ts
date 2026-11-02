import { getNetworkStateAsync } from "expo-network";

import { readStoredAccount } from "@/lib/supabase";
import type { AccountProbe } from "./session";

export const accountProbe: AccountProbe = {
  stored: () => readStoredAccount(),
  offline: async () => (await getNetworkStateAsync()).isConnected === false,
};
