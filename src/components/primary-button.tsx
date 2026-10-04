import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radius, typography } from "@/theme";

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radius.block,
    paddingVertical: 16,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.paper,
    fontWeight: "600",
  },
});
