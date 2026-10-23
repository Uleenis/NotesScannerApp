import { Alert, Keyboard } from "react-native";

export type MenuItem = { label: string; destructive?: boolean; onPress: () => void };
export type OpenMenu = { items: MenuItem[]; cancelLabel: string };

let current: OpenMenu | null = null;
const listeners = new Set<() => void>();

function publish(next: OpenMenu | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentMenu(): OpenMenu | null {
  return current;
}

export function showMenu(items: MenuItem[], cancelLabel: string): void {
  Keyboard.dismiss();
  publish({ items, cancelLabel });
}

export function closeMenu(): void {
  publish(null);
}

export function confirmDeletion(title: string, body: string, labels: { cancel: string; confirm: string }, onConfirm: () => void): void {
  Alert.alert(title, body, [
    { text: labels.cancel, style: "cancel" },
    { text: labels.confirm, style: "destructive", onPress: onConfirm },
  ]);
}
