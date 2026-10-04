import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { useLanguage, type Language } from "@/i18n";
import type { AuthResult } from "./session";

export type AuthState =
  | { status: "loading"; userId: null }
  | { status: "unavailable"; userId: null }
  | { status: "ready"; userId: string };

export type AuthServices = {
  ensureSession: () => Promise<AuthResult>;
  syncLanguage: (userId: string, language: Language) => Promise<boolean>;
};

const RETRY_DELAYS_MS = [2000, 4000, 8000, 30000];

const LOADING: AuthState = { status: "loading", userId: null };

const AuthContext = createContext<AuthState>(LOADING);

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

function retryDelay(failures: number): number {
  return RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
}

export function AuthProvider({ children, services }: { children: ReactNode; services: AuthServices }) {
  const language = useLanguage();
  const [result, setResult] = useState<AuthResult | null>(null);

  useEffect(() => {
    let active = true;
    let ready = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function attempt(): Promise<void> {
      if (!active || ready || running) {
        return;
      }
      clearTimeout(timer);
      running = true;
      const outcome = await services.ensureSession();
      running = false;
      if (!active) {
        return;
      }
      if (outcome.status === "ready") {
        ready = true;
        setResult(outcome);
        return;
      }
      setResult(outcome);
      timer = setTimeout(attempt, retryDelay(failures));
      failures += 1;
    }

    attempt();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        attempt();
      }
    });

    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [services]);

  const userId = result?.status === "ready" ? result.userId : null;

  useEffect(() => {
    if (userId !== null) {
      services.syncLanguage(userId, language);
    }
  }, [services, userId, language]);

  const state = useMemo<AuthState>(() => {
    if (result === null) {
      return LOADING;
    }
    return result.status === "ready"
      ? { status: "ready", userId: result.userId }
      : { status: "unavailable", userId: null };
  }, [result]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
