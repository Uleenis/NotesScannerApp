import type { ReactNode } from "react";
import { StyleSheet, Text, type TextProps } from "react-native";

import { useStrings } from "@/i18n";
import type { Piece } from "@/pages/display";
import type { PlacedWord } from "@/pages/words";
import { colors } from "@/theme";

type PieceTextProps = TextProps & {
  pieces: Piece[];
  words: PlacedWord[];
  editing: number | null;
  onEdit: (index: number) => void;
};

export function PieceText({ pieces, words, editing, onEdit, ...rest }: PieceTextProps) {
  const t = useStrings();
  const children: ReactNode[] = [];
  let next = 0;

  pieces.forEach((piece, at) => {
    if (piece.offset === null) {
      children.push(piece.text);
      return;
    }
    const from = piece.offset;
    const to = from + piece.text.length;
    let cursor = from;
    while (next < words.length && words[next].start < from) {
      next += 1;
    }
    while (next < words.length && words[next].end <= to) {
      const placed = words[next];
      if (placed.start === placed.end) {
        next += 1;
        continue;
      }
      if (placed.start > cursor) {
        children.push(piece.text.slice(cursor - from, placed.start - from));
      }
      children.push(
        <Text
          key={`${at}:${placed.word.index}`}
          accessibilityHint={t.document.wordHint}
          accessibilityRole="button"
          onPress={() => onEdit(placed.word.index)}
          style={editing === placed.word.index ? styles.editing : undefined}
        >
          {piece.text.slice(placed.start - from, placed.end - from)}
        </Text>,
      );
      cursor = placed.end;
      next += 1;
    }
    children.push(piece.text.slice(cursor - from));
  });

  return <Text {...rest}>{children}</Text>;
}

const styles = StyleSheet.create({
  editing: {
    backgroundColor: colors.highlight,
  },
});
