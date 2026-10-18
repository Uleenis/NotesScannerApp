import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { displayDocument } from "@/pages/display";
import type { NumberedPage, PageType } from "@/pages/pages";
import { useSetPageType } from "@/pages/queries";
import { colors, typography } from "@/theme";

const BLOCK_SPACING = typography.documentBody.lineHeight * 0.4;

function MathSwitch({ page }: { page: NumberedPage }) {
  const t = useStrings();
  const change = useSetPageType(page.id);
  const stored = page.pageType === "math";
  const [wanted, setWanted] = useState<{ math: boolean; from: PageType } | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = wanted !== null && wanted.from === page.pageType ? wanted.math : stored;

  async function toggle(math: boolean) {
    setFailed(false);
    setWanted({ math, from: page.pageType });
    const result = await change.mutateAsync(math ? "math" : "text").catch(() => ({ status: "error" }) as const);
    setWanted(null);
    if (result.status !== "done") {
      setFailed(true);
    }
  }

  return (
    <View style={styles.switchBlock}>
      <View style={styles.switchRow}>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.switchLabel}>
          {t.document.mathPage}
        </Text>
        <Switch
          accessibilityLabel={t.document.mathPage}
          value={shown}
          disabled={change.isPending}
          onValueChange={(math) => void toggle(math)}
          trackColor={{ false: colors.rule, true: colors.ink }}
          ios_backgroundColor={colors.rule}
          thumbColor={colors.sheet}
        />
      </View>
      {failed ? <Text style={styles.secondary}>{t.document.switchFailed}</Text> : null}
    </View>
  );
}

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
      {page.pageType === "unsupported_script" ? (
        <Text style={[styles.secondary, styles.warning]}>{t.document.unsupportedScript}</Text>
      ) : (
        <MathSwitch page={page} />
      )}
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
  switchBlock: {
    borderBottomColor: colors.rule,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
    paddingVertical: 8,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  switchLabel: {
    ...typography.interfaceBody,
    color: colors.ink,
  },
  secondary: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  warning: {
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
