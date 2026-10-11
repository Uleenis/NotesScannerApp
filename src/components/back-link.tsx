import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors, typography } from "@/theme";

export function BackLink({ name, label, onPress }: { name: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Ionicons name="chevron-back" size={24} color={colors.ink} />
      <Text numberOfLines={1} style={styles.name}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    maxWidth: 220,
  },
  name: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
});
