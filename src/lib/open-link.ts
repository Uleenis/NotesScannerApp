import { Linking } from "react-native";

export function openLink(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}
