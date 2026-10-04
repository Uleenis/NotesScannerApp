import { Pressable, StyleSheet, Text } from "react-native";

import { colors, typography } from "@/theme";

export function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" hitSlop={12} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
});
