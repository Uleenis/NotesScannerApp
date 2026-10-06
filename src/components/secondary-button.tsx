import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radius, typography } from "@/theme";

export function SecondaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: 1,
    paddingVertical: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.ink,
    fontWeight: "600",
  },
});
