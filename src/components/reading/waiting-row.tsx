import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import type { QueuedPage } from "@/offline/queue";
import { dateParts } from "@/pages/dates";
import { colors, typography } from "@/theme";

export function waitingState(t: ReturnType<typeof useStrings>, entry: QueuedPage): string {
  return entry.blocked === null ? t.waiting.state : t.waiting.blocked[entry.blocked];
}

export function WaitingRow({ entry, onPress }: { entry: QueuedPage; onPress: () => void }) {
  const t = useStrings();
  const parts = dateParts(entry.capturedAt, new Date());
  const date = parts === null ? null : t.dates.short(parts.day, parts.month, parts.year);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.title}>{date === null ? t.waiting.title : `${t.waiting.title} · ${date}`}</Text>
        <Text style={styles.state}>{waitingState(t, entry)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  texts: {
    gap: 4,
  },
  title: {
    ...typography.documentBody,
    color: colors.inkSecondary,
    fontFamily: typography.pageTitle.fontFamily,
    fontSize: 18,
  },
  state: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
});
