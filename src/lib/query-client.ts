import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";

export function createQueryClient(): QueryClient {
  return new QueryClient();
}

export function followAppFocus(): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
  return () => subscription.remove();
}
