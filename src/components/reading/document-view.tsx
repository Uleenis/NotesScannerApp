import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { useStrings } from "@/i18n";
import { dateParts } from "@/pages/dates";
import { cleanView } from "@/pages/clean";
import { displayPieces } from "@/pages/display";
import { mathDocument, type MathRow } from "@/pages/formulas";
import type { NumberedPage, PageType } from "@/pages/pages";
import { confirmDeletion } from "@/lib/action-menu";
import { useCorrectWord, usePageAlerts, usePageSecond, usePageWords, useSetPageType } from "@/pages/queries";
import { MAX_FORMULAS_PER_PAGE } from "@/pages/tex";
import { useTextEdit } from "@/pages/use-text-edit";
import { placeWords, type ChosenFrom, type PlacedWord } from "@/pages/words";
import { colors, typography } from "@/theme";
import { KeyboardLift } from "../keyboard-lift";
import { Formula } from "./formula";
import { FoundPhoto } from "./found-photo";
import { PageTextBar, PageTextField } from "./page-text-edit";
import { PieceText } from "./piece-text";
import { WordEditor } from "./word-editor";

const NO_WORDS: ReadonlySet<number> = new Set();

const BLOCK_SPACING = typography.documentBody.lineHeight * 0.4;

function MathSwitch({ page, mayLoseWork }: { page: NumberedPage; mayLoseWork: boolean }) {
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
    if (mayLoseWork) {
      confirmDeletion(t.document.switchLosesTitle, t.document.switchLosesBody, { cancel: t.common.cancel, confirm: t.document.switchLosesConfirm }, () => void toggle(math));
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

export function DocumentView({ page, found = null }: { page: NumberedPage; found?: number | null }) {
  const t = useStrings();
  const isMath = page.pageType === "math";
  const math = isMath ? mathDocument(page.text ?? "") : null;
  const parts = dateParts(page.capturedAt, new Date());
  const info = parts === null ? t.document.pageNumber(page.number) : t.document.info(page.number, t.dates.long(parts.day, parts.month, parts.year));

  const read = page.status === "read";
  const correctable = page.pageType === "text" && read;
  const stored = usePageWords(page.id, read && (page.pageType === "text" || page.pageType === "math"), page.text ?? "", page.pageType === "text");
  const alerts = usePageAlerts(page.id, read && page.pageType !== "unsupported_script");
  const correct = useCorrectWord(page.id);
  const [editing, setEditing] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const scrolled = useRef(0);
  const frame = useRef<View>(null);
  const [viewport, setViewport] = useState(0);
  const [revealed, setRevealed] = useState<number | null>(null);
  const second = usePageSecond(page.id, correctable);
  const placed = useMemo<PlacedWord[]>(
    () => (correctable && stored.data !== undefined ? (placeWords(page.text ?? "", stored.data) ?? []) : []),
    [correctable, stored.data, page.text],
  );
  const untouched = stored.data !== undefined && stored.data.gaps.length === 0 && stored.data.corrections.every((correction) => correction.text !== "");
  const tightened = untouched ? (second.data ?? null) : null;
  const clean = useMemo(() => (isMath ? null : cleanView(page.text ?? "", placed, tightened)), [isMath, page.text, placed, tightened]);
  const words = clean === null ? placed : clean.words;
  const laid = clean === null ? null : displayPieces(clean.text);
  const current = editing === null ? null : (words.find((placed) => placed.word.index === editing) ?? null);
  const mayLoseWork = stored.data === undefined || stored.data.corrections.length > 0 || stored.data.gaps.length > 0;
  const textEdit = useTextEdit(page, placed, clean === null ? (page.text ?? "") : clean.text, clean === null ? NO_WORDS : clean.hidden);
  const editable = read && ((page.pageType === "text" && words.length > 0) || page.pageType === "math");
  const writing = textEdit.draft !== null;
  const shownAlerts = (alerts.data ?? []).filter((kind) => (kind === "missing_line" ? page.pageType === "text" : page.pageType === "math"));

  function edit(index: number, touchedY: number | null) {
    setFailed(false);
    setEditing(index);
    if (touchedY === null) {
      setRevealed(null);
      return;
    }
    frame.current?.measureInWindow((_x, top) => setRevealed(touchedY - top + scrolled.current));
  }

  useEffect(() => {
    if (editing === null || revealed === null || viewport === 0) {
      return;
    }
    const margin = 16;
    const half = typography.documentBody.lineHeight / 2;
    if (revealed - half < scrolled.current + margin) {
      scroller.current?.scrollTo({ y: Math.max(0, revealed - half - margin), animated: true });
    } else if (revealed + half > scrolled.current + viewport - margin) {
      scroller.current?.scrollTo({ y: revealed + half - viewport + margin, animated: true });
    }
  }, [editing, revealed, viewport]);

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

  const title =
    laid !== null ? (
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
    );

  const infoRow = (
    <View style={styles.infoRow}>
      <Text style={styles.info}>{info}</Text>
      {editable && !writing ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setEditing(null);
            textEdit.start();
          }}
          style={styles.editAction}
        >
          <Text style={styles.editText}>{t.document.edit}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <KeyboardLift style={styles.fill}>
      {textEdit.draft !== null ? (
        <View style={[styles.fill, styles.content]}>
          {infoRow}
          <PageTextField value={textEdit.draft} saving={textEdit.saving} onChange={textEdit.setDraft} />
        </View>
      ) : (
        <View ref={frame} collapsable={false} style={styles.fill}>
          <ScrollView
            ref={scroller}
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrolled.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {infoRow}
            {found !== null && correctable ? <FoundPhoto pageId={page.id} tokenIndex={found} /> : null}
            {title}
            {shownAlerts.map((kind) => (
              <Text key={kind} style={[styles.secondary, styles.alert]}>
                {kind === "missing_line" ? t.document.alertMissingLine : t.document.alertMathIncomplete}
              </Text>
            ))}
            {page.pageType === "unsupported_script" ? (
              <Text style={[styles.secondary, styles.warning]}>{t.document.unsupportedScript}</Text>
            ) : (
              <MathSwitch page={page} mayLoseWork={mayLoseWork} />
            )}
            {math !== null ? (
              <MathBody rows={math.rows} />
            ) : (
              laid?.blocks.map((block, index) =>
                block.kind === "gap" ? (
                  <View key={index} testID="page-gap" style={styles.gap} />
                ) : (
                  <PieceText
                    key={index}
                    selectable
                    style={styles.line}
                    pieces={block.pieces}
                    words={words}
                    editing={editing}
                    onEdit={edit}
                  />
                ),
              )
            )}
          </ScrollView>
        </View>
      )}
      {writing ? (
        <PageTextBar problem={textEdit.problem} saving={textEdit.saving} onCancel={textEdit.cancel} onSave={() => void textEdit.save()} />
      ) : current !== null ? (
        <WordEditor
          key={current.word.index}
          word={current}
          saving={correct.isPending}
          failed={failed}
          onSubmit={(text, chosenFrom) => void save(current, text, chosenFrom)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </KeyboardLift>
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
  infoRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  info: {
    ...typography.interfaceSecondary,
    color: colors.inkSecondary,
  },
  editAction: {
    justifyContent: "center",
    minHeight: 44,
  },
  editText: {
    ...typography.interfaceBody,
    color: colors.blue,
  },
  alert: {
    paddingBottom: 12,
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
