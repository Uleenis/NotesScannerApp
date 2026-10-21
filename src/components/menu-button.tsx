import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { colors } from "@/theme";

export function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={12} onPress={onPress} style={styles.button}>
      <Ionicons name="ellipsis-horizontal-circle-outline" size={28} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
});
