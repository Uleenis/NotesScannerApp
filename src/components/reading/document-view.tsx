import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { displayDocument } from "@/pages/display";
import type { NumberedPage } from "@/pages/pages";
import { colors, typography } from "@/theme";

const BLOCK_SPACING = typography.documentBody.lineHeight * 0.4;

export function DocumentView({ page }: { page: NumberedPage }) {
  const t = useStrings();
  const { title, blocks } = displayDocument(page.text ?? "");
  const parts = dateParts(page.capturedAt, new Date());
  const info = parts === null ? t.document.pageNumber(page.number) : t.document.info(page.number, t.dates.long(parts.day, parts.month, parts.year));

  return (
    <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.info}>{info}</Text>
      <Text accessibilityRole="header" selectable style={styles.title}>
        {title ?? t.document.pageNumber(page.number)}
      </Text>
      {blocks.map((block, index) =>
        block.kind === "gap" ? (
          <View key={index} style={styles.gap} />
        ) : (
          <Text key={index} selectable style={styles.line}>
            {block.text}
          </Text>
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 48,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  info: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
    paddingBottom: 8,
  },
  title: {
    ...typography.pageTitle,
    color: colors.ink,
    paddingBottom: 20,
  },
  line: {
    ...typography.documentBody,
    color: colors.ink,
    paddingBottom: BLOCK_SPACING,
  },
  gap: {
    height: typography.documentBody.lineHeight,
  },
});
