import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import type { RenderMode } from "@/render/mode";
import { colors, radius, typography } from "@/theme";

type RenderSwitchProps = { mode: RenderMode; onChange: (mode: RenderMode) => void };

export function RenderSwitch({ mode, onChange }: RenderSwitchProps) {
  const t = useStrings();
  const options: { value: RenderMode; label: string }[] = [
    { value: "faithful", label: t.rendering.faithful },
    { value: "enriched", label: t.rendering.enriched },
  ];
  return (
    <View accessibilityLabel={t.rendering.switchLabel} accessibilityRole="radiogroup" style={styles.row}>
      {options.map((option) => {
        const selected = option.value === mode;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected ? styles.selected : null]}
          >
            <Text style={[styles.label, selected ? styles.selectedLabel : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: "flex-start",
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    marginBottom: 12,
    overflow: "hidden",
  },
  option: {
    justifyContent: "center",
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: 16,
  },
  selected: {
    backgroundColor: colors.blueTint,
  },
  label: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    textAlign: "center",
  },
  selectedLabel: {
    color: colors.blue,
  },
});
