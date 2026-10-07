import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius } from "@/theme";

export function AccountGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: 1,
    overflow: "hidden",
  },
});
