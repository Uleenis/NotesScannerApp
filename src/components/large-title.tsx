import { StyleSheet, Text } from "react-native";

import { colors, typography } from "@/theme";

export function LargeTitle({ text }: { text: string }) {
  return (
    <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.largeTitle,
    color: colors.ink,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
});
