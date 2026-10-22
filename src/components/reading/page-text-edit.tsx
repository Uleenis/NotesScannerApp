import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useStrings } from "@/i18n";
import type { EditProblem } from "@/pages/use-text-edit";
import { colors, typography } from "@/theme";

export function PageTextField({ value, saving, onChange }: { value: string; saving: boolean; onChange: (value: string) => void }) {
  const t = useStrings();
  return (
    <TextInput
      accessibilityLabel={t.document.editField}
      autoFocus
      editable={!saving}
      multiline
      onChangeText={onChange}
      scrollEnabled={false}
      style={styles.field}
      textAlignVertical="top"
      value={value}
    />
  );
}

export function PageTextBar({ problem, saving, onCancel, onSave }: { problem: EditProblem | null; saving: boolean; onCancel: () => void; onSave: () => void }) {
  const t = useStrings();
  const sentence =
    problem === "tooBig"
      ? t.document.editTooBig
      : problem === "changed"
        ? t.document.editChanged
        : problem === "refused"
          ? t.document.editRefused
          : problem === "failed"
            ? t.document.editSaveFailed
            : null;
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={onCancel} style={styles.action}>
          <Text style={styles.actionText}>{t.common.cancel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} hitSlop={8} onPress={onSave} style={styles.action}>
          <Text style={[styles.actionText, styles.save, saving ? styles.disabled : null]}>{t.document.editSave}</Text>
        </Pressable>
      </View>
      {sentence !== null ? <Text style={styles.problem}>{sentence}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    ...typography.documentBody,
    color: colors.ink,
    minHeight: 240,
    padding: 0,
  },
  bar: {
    backgroundColor: colors.sheet,
    borderTopColor: colors.rule,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  action: {
    justifyContent: "center",
    minHeight: 44,
  },
  actionText: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
  save: {
    fontWeight: "600",
  },
  disabled: {
    color: colors.inkTertiary,
  },
  problem: {
    ...typography.footnote,
    color: colors.danger,
    paddingBottom: 4,
  },
});
