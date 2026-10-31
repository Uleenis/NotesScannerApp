import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { SecondaryButton } from "@/components/secondary-button";
import { colors, typography } from "@/theme";

export type SeriesAction = { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean };

type Props = { lines: string[]; busy?: boolean; actions?: SeriesAction[] };

export function SeriesNotice({ lines, busy = false, actions = [] }: Props) {
  return (
    <View style={styles.container}>
      {busy ? <ActivityIndicator color={colors.ink} /> : null}
      {lines.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
      {actions.map((action) =>
        action.secondary === true ? (
          <SecondaryButton disabled={action.disabled} key={action.label} label={action.label} onPress={action.onPress} />
        ) : (
          <PrimaryButton disabled={action.disabled} key={action.label} label={action.label} onPress={action.onPress} />
        ),
      )}
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
  line: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    textAlign: "center",
  },
});
