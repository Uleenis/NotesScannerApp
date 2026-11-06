import { useSyncExternalStore } from "react";
import { Alert } from "react-native";

let online = true;
const listeners = new Set<() => void>();

export function setOnline(next: boolean): void {
  if (online === next) {
    return;
  }
  online = next;
  listeners.forEach((listener) => listener());
}

export function isOnline(): boolean {
  return online;
}

export function subscribeToNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToNetwork, isOnline, isOnline);
}

export function whenOnline(message: string, action: () => void): void {
  if (!online) {
    Alert.alert(message);
    return;
  }
  action();
}
