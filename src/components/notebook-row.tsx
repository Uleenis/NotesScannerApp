import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import type { NotebookSummary } from "@/notebooks/notebooks";
import { colors, typography } from "@/theme";

export function NotebookRow({ notebook, onPress }: { notebook: NotebookSummary; onPress: () => void }) {
  const t = useStrings();

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.name}>{notebook.name}</Text>
        <Text style={styles.count}>{t.notebook.pageCount(notebook.pageCount)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.inkTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingVertical: 14,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  count: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
});
