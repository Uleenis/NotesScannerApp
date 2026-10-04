import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useStrings } from "@/i18n";
import { colors } from "@/theme";

export function AccountButton() {
  const t = useStrings();

  return (
    <Pressable accessibilityLabel={t.account.title} accessibilityRole="button" onPress={() => router.push("/account")}>
      <Ionicons name="person-circle-outline" size={28} color={colors.ink} />
    </Pressable>
  );
}
