import { StyleSheet, Text, View, type TextStyle } from "react-native";

import type { RichBlock, RichSpan } from "@/render/markdown";
import { MAX_FORMULAS_PER_PAGE } from "@/pages/tex";
import { colors, fontFamilies, typography } from "@/theme";
import { Formula } from "./formula";

const BLOCK_SPACING = typography.documentBody.lineHeight * 0.4;

type RichBodyProps = { blocks: RichBlock[]; onTouch: () => void };

function spanStyle(span: Extract<RichSpan, { kind: "text" }>): TextStyle | undefined {
  if (!span.bold && !span.italic) {
    return undefined;
  }
  if (span.bold) {
    return { fontFamily: fontFamilies.serifSemiBold, fontStyle: span.italic ? "italic" : "normal" };
  }
  return { fontFamily: fontFamilies.serifItalic };
}

export function RichBody({ blocks, onTouch }: RichBodyProps) {
  let formulas = 0;
  const overBudget = (): boolean => {
    formulas += 1;
    return formulas > MAX_FORMULAS_PER_PAGE;
  };

  const spans = (list: RichSpan[]) =>
    list.map((span, at) =>
      span.kind === "text" ? (
        <Text key={at} style={spanStyle(span)}>
          {span.text}
        </Text>
      ) : (
        <Formula key={at} tex={span.tex} source={span.source} display={false} raw={overBudget()} />
      ),
    );

  return blocks.map((block, index) => {
    if (block.kind === "display") {
      return <Formula key={index} tex={block.tex} source={block.source} display raw={overBudget()} />;
    }
    if (block.kind === "heading") {
      return (
        <Text key={index} accessibilityRole="header" onPress={onTouch} selectable style={headingStyles[block.level - 1]}>
          {spans(block.spans)}
        </Text>
      );
    }
    if (block.kind === "item") {
      return (
        <View key={index} style={[styles.item, block.depth === 1 ? styles.nested : null]}>
          <Text style={styles.marker}>{block.marker === null ? "•" : `${block.marker}.`}</Text>
          <Text onPress={onTouch} selectable style={[styles.line, styles.itemText]}>
            {spans(block.spans)}
          </Text>
        </View>
      );
    }
    return (
      <Text key={index} onPress={onTouch} selectable style={styles.line}>
        {spans(block.spans)}
      </Text>
    );
  });
}

const heading: TextStyle = {
  color: colors.ink,
  fontFamily: fontFamilies.serifSemiBold,
  paddingBottom: BLOCK_SPACING,
  paddingTop: BLOCK_SPACING,
};

const headingStyles = [
  { ...typography.pageTitle, ...heading, paddingBottom: 20, paddingTop: 0 },
  { ...typography.documentBody, ...heading, fontSize: 22, lineHeight: 30 },
  { ...typography.documentBody, ...heading, fontSize: 19, lineHeight: 28 },
] satisfies TextStyle[];

const styles = StyleSheet.create({
  line: {
    ...typography.documentBody,
    color: colors.ink,
    paddingBottom: BLOCK_SPACING,
  },
  item: {
    flexDirection: "row",
  },
  nested: {
    paddingLeft: 24,
  },
  marker: {
    ...typography.documentBody,
    color: colors.inkSecondary,
    minWidth: 28,
  },
  itemText: {
    flex: 1,
  },
});
