import { useMemo, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { displayPieces } from "@/pages/display";
import { mathDocument, type MathRow } from "@/pages/formulas";
import type { NumberedPage, PageType } from "@/pages/pages";
import { confirmDeletion } from "@/lib/action-menu";
import { useCorrectWord, usePageWords, useSetPageType } from "@/pages/queries";
import { MAX_FORMULAS_PER_PAGE } from "@/pages/tex";
import { placeWords, type ChosenFrom, type PlacedWord } from "@/pages/words";
import { colors, typography } from "@/theme";
import { Formula } from "./formula";
import { PieceText } from "./piece-text";
import { WordEditor } from "./word-editor";

const BLOCK_SPACING = typography.documentBody.lineHeight * 0.4;

function MathSwitch({ page, mayLoseCorrections }: { page: NumberedPage; mayLoseCorrections: boolean }) {
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

  function ask(math: boolean) {
    if (math && mayLoseCorrections) {
      confirmDeletion(t.document.switchLosesTitle, t.document.switchLosesBody, { cancel: t.common.cancel, confirm: t.document.switchLosesConfirm }, () => void toggle(true));
    } else {
      void toggle(math);
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
          onValueChange={ask}
          trackColor={{ false: colors.rule, true: colors.ink }}
          ios_backgroundColor={colors.rule}
          thumbColor={colors.sheet}
        />
      </View>
      {failed ? <Text style={styles.secondary}>{t.document.switchFailed}</Text> : null}
    </View>
  );
}

function MathBody({ rows }: { rows: MathRow[] }) {
  let formulas = 0;
  const overBudget = (): boolean => {
    formulas += 1;
    return formulas > MAX_FORMULAS_PER_PAGE;
  };
  return rows.map((row, index) => {
    if (row.kind === "gap") {
      return <View key={index} style={styles.gap} />;
    }
    if (row.kind === "display") {
      return <Formula key={index} tex={row.tex} source={row.source} display raw={overBudget()} />;
    }
    return (
      <Text key={index} selectable style={styles.line}>
        {row.parts.map((part, at) =>
          part.kind === "text" ? part.text : <Formula key={at} tex={part.tex} source={part.source} display={false} raw={overBudget()} />,
        )}
      </Text>
    );
  });
}

export function DocumentView({ page }: { page: NumberedPage }) {
  const t = useStrings();
  const math = page.pageType === "math" ? mathDocument(page.text ?? "") : null;
  const laid = math === null ? displayPieces(page.text ?? "") : null;
  const parts = dateParts(page.capturedAt, new Date());
  const info = parts === null ? t.document.pageNumber(page.number) : t.document.info(page.number, t.dates.long(parts.day, parts.month, parts.year));

  const correctable = page.pageType === "text" && page.status === "read";
  const stored = usePageWords(page.id, correctable, page.text ?? "");
  const correct = useCorrectWord(page.id);
  const [editing, setEditing] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const words = useMemo<PlacedWord[]>(
    () => (correctable && stored.data !== undefined ? (placeWords(page.text ?? "", stored.data) ?? []) : []),
    [correctable, stored.data, page.text],
  );
  const current = editing === null ? null : (words.find((placed) => placed.word.index === editing) ?? null);
  const mayLoseCorrections = stored.data === undefined || stored.data.corrections.length > 0;

  function edit(index: number) {
    setFailed(false);
    setEditing(index);
  }

  async function save(placed: PlacedWord, text: string, chosenFrom: ChosenFrom) {
    if (chosenFrom === "keyboard" && text === placed.shown) {
      setEditing(null);
      return;
    }
    setFailed(false);
    const result = await correct.mutateAsync({ tokenIndex: placed.word.index, text, chosenFrom }).catch(() => ({ status: "error" }) as const);
    if (result.status === "saved") {
      setEditing(null);
    } else {
      setFailed(true);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={styles.info}>{info}</Text>
        {laid !== null ? (
          <PieceText
            accessibilityRole="header"
            selectable
            style={styles.title}
            pieces={laid.title ?? [{ text: t.document.pageNumber(page.number), offset: null }]}
            words={words}
            editing={editing}
            onEdit={edit}
          />
        ) : (
          <Text accessibilityRole="header" selectable style={styles.title}>
            {math?.title ?? t.document.pageNumber(page.number)}
          </Text>
        )}
        {page.pageType === "unsupported_script" ? (
          <Text style={[styles.secondary, styles.warning]}>{t.document.unsupportedScript}</Text>
        ) : (
          <MathSwitch page={page} mayLoseCorrections={mayLoseCorrections} />
        )}
        {math !== null ? (
          <MathBody rows={math.rows} />
        ) : (
          laid?.blocks.map((block, index) =>
            block.kind === "gap" ? (
              <View key={index} style={styles.gap} />
            ) : (
              <PieceText key={index} selectable style={styles.line} pieces={block.pieces} words={words} editing={editing} onEdit={edit} />
            ),
          )
        )}
      </ScrollView>
      {current !== null ? (
        <WordEditor
          key={current.word.index}
          word={current}
          saving={correct.isPending}
          failed={failed}
          onSubmit={(text, chosenFrom) => void save(current, text, chosenFrom)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
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
