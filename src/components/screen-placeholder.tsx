import { StyleSheet, Text, View } from "react-native";

import { colors, typography } from "@/theme";

export function ScreenPlaceholder({ label, document = false }: { label: string; document?: boolean }) {
  return (
    <View style={styles.container}>
      <Text style={document ? styles.documentLabel : styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  label: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
  },
  documentLabel: {
    ...typography.pageTitle,
    color: colors.ink,
  },
});
