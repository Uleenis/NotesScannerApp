import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { displayDocument } from "@/pages/display";
import type { NumberedPage } from "@/pages/pages";
import { colors, radius, typography } from "@/theme";
import { PageStateLine } from "./page-state-line";

const EXCERPT_LINES = 5;

type Props = { page: NumberedPage; notebookName: string; onPress: () => void };

export function LatestPageCard({ page, notebookName, onPress }: Props) {
  const t = useStrings();
  const parts = dateParts(page.capturedAt, new Date());
  const meta = parts === null ? notebookName : t.library.cardMeta(notebookName, t.dates.short(parts.day, parts.month, parts.year));
  const { title, blocks } = displayDocument(page.status === "read" ? (page.text ?? "") : "");
  const excerpt = blocks.flatMap((block) => (block.kind === "line" ? [block.text] : [])).join("\n");

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
      <View style={styles.texts}>
        {page.status === "read" ? (
          <>
            <Text numberOfLines={2} style={styles.title}>
              {title ?? t.document.pageNumber(page.number)}
            </Text>
            <Text numberOfLines={EXCERPT_LINES} style={styles.excerpt}>
              {excerpt}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.pending}>{t.document.pageNumber(page.number)}</Text>
            <PageStateLine page={page} />
          </>
        )}
      </View>
      <Text numberOfLines={1} style={styles.meta}>
        {meta}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.sheet,
    borderColor: colors.rule,
    borderRadius: radius.block,
    borderWidth: StyleSheet.hairlineWidth,
    height: 176,
    justifyContent: "space-between",
    padding: 14,
    width: 210,
  },
  texts: {
    gap: 6,
  },
  title: {
    fontFamily: typography.pageTitle.fontFamily,
    fontSize: 17,
    color: colors.ink,
  },
  pending: {
    fontFamily: typography.pageTitle.fontFamily,
    fontSize: 17,
    color: colors.inkSecondary,
  },
  excerpt: {
    fontFamily: typography.documentBody.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  meta: {
    ...typography.footnote,
    color: colors.inkSecondary,
  },
});
