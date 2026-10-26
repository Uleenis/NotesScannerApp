import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";

export type RenderMode = "faithful" | "enriched";

const KEY = "render-mode";

type Listener = () => void;

let current: RenderMode = "faithful";
let loading: Promise<RenderMode> | null = null;
let chosen = false;
const listeners = new Set<Listener>();

function publish(mode: RenderMode): void {
  if (mode !== current) {
    current = mode;
    listeners.forEach((listener) => listener());
  }
}

export function loadRenderMode(): Promise<RenderMode> {
  loading ??= SecureStore.getItemAsync(KEY)
    .then((stored): RenderMode => (stored === "enriched" ? "enriched" : "faithful"))
    .catch((): RenderMode => "faithful")
    .then((mode) => {
      if (!chosen) {
        publish(mode);
      }
      return current;
    });
  return loading;
}

export function setRenderMode(mode: RenderMode): void {
  chosen = true;
  loading = Promise.resolve(mode);
  publish(mode);
  void SecureStore.setItemAsync(KEY, mode).catch(() => undefined);
}

export function resetRenderMode(): void {
  loading = null;
  chosen = false;
  current = "faithful";
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRenderMode(): RenderMode {
  useEffect(() => {
    void loadRenderMode();
  }, []);
  return useSyncExternalStore(subscribe, () => current);
}
