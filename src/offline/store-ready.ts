import { useSyncExternalStore } from "react";

let ready = false;
const listeners = new Set<() => void>();

export function announceStore(open: boolean): void {
  if (ready === open) {
    return;
  }
  ready = open;
  listeners.forEach((listener) => listener());
}

export function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isReady(): boolean {
  return ready;
}

export function useStoreReady(): boolean {
  return useSyncExternalStore(subscribeToStore, isReady, isReady);
}
