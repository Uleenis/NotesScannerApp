import { StyleSheet } from "react-native";

import { colors, radius, typography } from "@/theme";

export const trainingStyles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
  },
  body: {
    ...typography.interfaceBody,
    color: colors.inkSecondary,
    paddingBottom: 24,
    paddingTop: 12,
  },
  section: {
    ...typography.interfaceBody,
    color: colors.ink,
    paddingBottom: 16,
  },
  field: {
    ...typography.interfaceBody,
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldFocused: {
    borderColor: colors.ink,
  },
  error: {
    ...typography.interfaceSecondary,
    color: colors.danger,
    paddingTop: 12,
  },
  note: {
    ...typography.footnote,
    color: colors.inkSecondary,
    paddingTop: 12,
  },
  button: {
    paddingTop: 16,
  },
  link: {
    ...typography.interfaceSecondary,
    color: colors.ink,
    paddingTop: 20,
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
