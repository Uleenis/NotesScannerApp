import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { colors, typography } from "@/theme";

type Props = { message: string; actionLabel?: string; onAction?: () => void };

export function BlockedCapture({ message, actionLabel, onAction }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {actionLabel !== undefined && onAction !== undefined ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  message: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
});
