import { StyleSheet, Text } from "react-native";

import { useStrings } from "@/i18n";
import { useOnline } from "@/offline/network";
import { colors, typography } from "@/theme";

export function OfflineLine() {
  const t = useStrings();
  const online = useOnline();

  return online ? null : <Text style={styles.line}>{t.offline.banner}</Text>;
}

const styles = StyleSheet.create({
  line: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
});
