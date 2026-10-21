import { StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, typography } from "@/theme";

type Props = {
  label: string;
  value: string;
  message: string;
  problem: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
};

export function NameForm({ label, value, message, problem, onChange, onSubmit }: Props) {
  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel={label}
        autoFocus
        maxLength={200}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        style={[styles.field, problem && styles.fieldWithProblem]}
        submitBehavior="submit"
        value={value}
      />
      <Text style={problem ? styles.problem : styles.hint}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    padding: 16,
  },
  field: {
    ...typography.interfaceBody,
    backgroundColor: colors.paper,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldWithProblem: {
    borderColor: colors.ink,
    borderWidth: 1,
  },
  hint: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingHorizontal: 4,
  },
  problem: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    paddingHorizontal: 4,
  },
});
