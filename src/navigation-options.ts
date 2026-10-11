import type { NativeStackNavigationOptions } from "expo-router";

import { colors } from "@/theme";

export const stackScreenOptions: NativeStackNavigationOptions = {
  title: "",
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.paper },
  headerLargeStyle: { backgroundColor: colors.paper },
  headerTintColor: colors.ink,
  contentStyle: { backgroundColor: colors.paper },
};

export const newNotebookOptions: NativeStackNavigationOptions = {
  headerTitleAlign: "center",
  contentStyle: { backgroundColor: colors.sheet },
};
