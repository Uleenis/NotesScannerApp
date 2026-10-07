import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, typography } from "@/theme";

type Props = {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  last?: boolean;
};

export function AccountRow({ label, value, onPress, danger = false, disabled = false, last = false }: Props) {
  const content = (
    <>
      <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
      {value === undefined ? null : <Text style={styles.value}>{value}</Text>}
    </>
  );
  const rowStyle = [styles.row, !last && styles.separator, disabled && styles.disabled];

  if (onPress === undefined) {
    return <View style={rowStyle}>{content}</View>;
  }
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={rowStyle}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  separator: {
    borderBottomColor: colors.rule,
    borderBottomWidth: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  danger: {
    color: colors.danger,
  },
  value: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    flexShrink: 1,
  },
});
