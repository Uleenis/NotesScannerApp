import { StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, typography } from "@/theme";

const LENGTH = 6;

const POSITIONS = [0, 1, 2, 3, 4, 5];

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
};

export function CodeField({ label, value, onChange, onComplete, disabled = false }: Props) {
  function change(text: string) {
    if (disabled) {
      return;
    }
    const digits = text.replace(/\D/g, "").slice(0, LENGTH);
    onChange(digits);
    if (digits.length === LENGTH && value.length !== LENGTH) {
      onComplete(digits);
    }
  }

  const current = Math.min(value.length, LENGTH - 1);

  return (
    <View style={styles.field}>
      <View style={styles.boxes}>
        {POSITIONS.map((position) => (
          <View key={position} style={[styles.box, position === current && !disabled && styles.current]}>
            <Text accessibilityState={{ selected: position === current }} style={styles.digit} testID={`code-box-${position}`}>
              {value[position] ?? ""}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel={label}
        autoComplete="one-time-code"
        autoFocus
        caretHidden
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={LENGTH}
        onChangeText={change}
        style={styles.input}
        textContentType="oneTimeCode"
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 56,
  },
  boxes: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  box: {
    alignItems: "center",
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: "center",
  },
  current: {
    borderColor: colors.ink,
  },
  digit: {
    ...typography.pageTitle,
    color: colors.ink,
  },
  input: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    opacity: 0.01,
  },
});
