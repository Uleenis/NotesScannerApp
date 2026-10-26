import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";

const ACCOUNT_KEYS = ["pages", "notebooks", "notebook", "allowance", "latest-notebook", "page", "photo-url", "page-words", "search", "anchor", "page-rendering"];

export function createQueryClient(): QueryClient {
  return new QueryClient();
}

export function forgetOtherAccounts(queryClient: QueryClient, userId: string | null): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const [name, owner] = query.queryKey;
      return typeof name === "string" && ACCOUNT_KEYS.includes(name) && owner !== userId;
    },
  });
}

export function followAppFocus(): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
  return () => subscription.remove();
}
