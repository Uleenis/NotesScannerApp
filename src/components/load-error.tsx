import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useStrings();

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <PrimaryButton label={t.common.retry} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  message: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
});
