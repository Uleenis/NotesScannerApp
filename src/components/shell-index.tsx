import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { colors, typography } from "@/theme";

export function ShellIndex() {
  const t = useStrings();
  const rows = [
    { label: t.shell.notebook, href: "/notebook/preview" },
    { label: t.shell.page, href: "/page/preview" },
    { label: t.shell.capture, href: "/capture" },
    { label: t.shell.signIn, href: "/sign-in" },
    { label: t.shell.code, href: "/sign-in/code" },
  ] as const;

  return (
    <View>
      {rows.map((row) => (
        <Link key={row.href} href={row.href} asChild>
          <Pressable style={styles.row}>
            <Text style={styles.label}>{row.label}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  label: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
});
