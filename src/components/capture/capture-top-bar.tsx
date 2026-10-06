import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { colors, radius, typography } from "@/theme";

type Props = {
  notebookName: string | null;
  flash: boolean | null;
  onCancel: () => void;
  onNotebook: () => void;
  onFlash: () => void;
};

export function CaptureTopBar({ notebookName, flash, onCancel, onNotebook, onFlash }: Props) {
  const t = useStrings();

  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" hitSlop={12} onPress={onCancel} style={styles.side}>
        <Text style={styles.cancel}>{t.common.cancel}</Text>
      </Pressable>
      {notebookName === null ? null : (
        <Pressable accessibilityLabel={t.capture.notebookLabel} accessibilityRole="button" onPress={onNotebook} style={styles.chip}>
          <Text numberOfLines={1} style={styles.chipLabel}>
            {notebookName}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.ink} />
        </Pressable>
      )}
      <View style={[styles.side, styles.right]}>
        {flash === null ? null : (
          <Pressable accessibilityLabel={t.capture.flashLabel} accessibilityRole="button" hitSlop={12} onPress={onFlash}>
            <Ionicons name={flash ? "flash" : "flash-off-outline"} size={24} color={colors.ink} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  side: {
    flex: 1,
  },
  right: {
    alignItems: "flex-end",
  },
  cancel: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.block * 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    maxWidth: 180,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipLabel: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    flexShrink: 1,
  },
});
