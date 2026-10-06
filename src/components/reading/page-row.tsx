import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { pageTitle } from "@/pages/display";
import type { NumberedPage } from "@/pages/pages";
import { colors, typography } from "@/theme";
import { PageStateLine } from "./page-state-line";

export function PageRow({ page, onPress }: { page: NumberedPage; onPress: () => void }) {
  const t = useStrings();
  const parts = dateParts(page.capturedAt, new Date());
  const date = parts === null ? null : t.dates.short(parts.day, parts.month, parts.year);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      {page.status === "read" ? (
        <View style={styles.texts}>
          <Text numberOfLines={2} style={styles.title}>
            {pageTitle(page.text ?? "") ?? t.document.pageNumber(page.number)}
          </Text>
          <Text style={styles.meta}>{date === null ? t.document.pageNumber(page.number) : t.document.info(page.number, date)}</Text>
        </View>
      ) : (
        <View style={styles.texts}>
          <Text style={styles.pending}>{t.document.pageNumber(page.number)}</Text>
          <PageStateLine page={page} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  texts: {
    gap: 4,
  },
  title: {
    ...typography.documentBody,
    color: colors.ink,
    fontFamily: typography.pageTitle.fontFamily,
    fontSize: 18,
  },
  pending: {
    ...typography.documentBody,
    color: colors.inkSecondary,
    fontFamily: typography.pageTitle.fontFamily,
    fontSize: 18,
  },
  meta: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
});
