import { ActionSheetIOS, Alert } from "react-native";

export type MenuItem = { label: string; destructive?: boolean; onPress: () => void };

export function showMenu(items: MenuItem[], cancelLabel: string): void {
  const destructive = items.findIndex((item) => item.destructive === true);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: [...items.map((item) => item.label), cancelLabel],
      cancelButtonIndex: items.length,
      destructiveButtonIndex: destructive === -1 ? undefined : destructive,
    },
    (index) => items[index]?.onPress(),
  );
}

export function confirmDeletion(title: string, body: string, labels: { cancel: string; confirm: string }, onConfirm: () => void): void {
  Alert.alert(title, body, [
    { text: labels.cancel, style: "cancel" },
    { text: labels.confirm, style: "destructive", onPress: onConfirm },
  ]);
}
