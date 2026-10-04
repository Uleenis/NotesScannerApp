import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function FirstLaunch({ onCreate }: { onCreate: () => void }) {
  const t = useStrings();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={styles.message}>
        <View style={styles.stroke} />
        <Text style={styles.title}>{t.library.firstLaunch.title}</Text>
        <Text style={styles.body}>{t.library.firstLaunch.body}</Text>
      </View>
      <View style={[styles.action, { paddingBottom: insets.bottom + 16 }]}>
        <PrimaryButton label={t.library.firstLaunch.create} onPress={onCreate} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  message: {
    alignItems: "center",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  stroke: {
    backgroundColor: colors.ink,
    borderRadius: 2,
    height: 3,
    width: 56,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
    textAlign: "center",
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  action: {
    paddingHorizontal: 16,
  },
});
