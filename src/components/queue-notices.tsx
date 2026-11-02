import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dismissNotices, useNotices } from "@/offline/queue-state";
import { colors, typography } from "@/theme";

export function QueueNotices() {
  const t = useStrings();
  const notices = useNotices();
  const lines = [...(notices.lost > 0 ? [t.waiting.lost(notices.lost)] : []), ...(notices.rejected > 0 ? [t.waiting.rejected(notices.rejected)] : [])];

  if (lines.length === 0) {
    return null;
  }
  return (
    <View style={styles.box}>
      {lines.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
      <Pressable accessibilityRole="button" onPress={dismissNotices}>
        <Text style={styles.dismiss}>{t.limit.understood}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  line: {
    ...typography.interfaceSecondary,
    color: colors.ink,
  },
  dismiss: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    fontWeight: "600",
    paddingVertical: 4,
  },
});
