export type DisplayBlock = { kind: "line"; text: string } | { kind: "gap" };

export type DisplayDocument = { title: string | null; blocks: DisplayBlock[] };

const OPENING_MARKS = /^[\s([«"'“‘]+/u;
const LIST_ITEM_START = /^\s*(?:[-–—•*·▪●◦]|[\p{L}\p{N}]{1,2}[).]\s)/u;
const LATEX = /\$|\\\p{L}+/u;
const JOINING_END = /(?:->|→|=>|⇒|,|:|[-–—])\s*$/u;
const LOWERCASE_START = /^\p{Ll}/u;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

export function pageTitle(text: string): string | null {
  const first = splitLines(text).find((line) => !isBlank(line));
  return first === undefined ? null : first.trim();
}

export function joinsPrevious(previous: string, line: string): boolean {
  if (isBlank(previous) || isBlank(line)) {
    return false;
  }
  if (LIST_ITEM_START.test(line) || LATEX.test(previous) || LATEX.test(line)) {
    return false;
  }
  return LOWERCASE_START.test(line.replace(OPENING_MARKS, "")) || JOINING_END.test(previous);
}

export type Piece = { text: string; offset: number | null };

export type PieceBlock = { kind: "line"; pieces: Piece[] } | { kind: "gap" };

export type DisplayPieces = { title: Piece[] | null; blocks: PieceBlock[] };

type PlacedLine = { text: string; offset: number };

function placedLines(text: string): PlacedLine[] {
  const lines: PlacedLine[] = [];
  const separator = /\r?\n/g;
  let from = 0;
  for (let found = separator.exec(text); found !== null; found = separator.exec(text)) {
    lines.push({ text: text.slice(from, found.index), offset: from });
    from = found.index + found[0].length;
  }
  lines.push({ text: text.slice(from), offset: from });
  return lines;
}

const piecesText = (pieces: Piece[]): string => pieces.map((piece) => piece.text).join("");

export function displayPieces(text: string): DisplayPieces {
  const lines = placedLines(text);
  const titleIndex = lines.findIndex((line) => !isBlank(line.text));
  if (titleIndex === -1) {
    return { title: null, blocks: [] };
  }

  const blocks: PieceBlock[] = [];
  let previousLine = "";
  for (const line of lines.slice(titleIndex + 1)) {
    const last = blocks[blocks.length - 1];
    const piece: Piece = { text: line.text, offset: line.offset };
    if (isBlank(line.text)) {
      if (last !== undefined && last.kind === "line") {
        blocks.push({ kind: "gap" });
      }
    } else if (last !== undefined && last.kind === "line" && joinsPrevious(previousLine, line.text)) {
      const before = piecesText(last.pieces);
      const spaced = /\s$/u.test(before) || /^\s/u.test(line.text);
      blocks[blocks.length - 1] = { kind: "line", pieces: spaced ? [...last.pieces, piece] : [...last.pieces, { text: " ", offset: null }, piece] };
    } else {
      blocks.push({ kind: "line", pieces: [piece] });
    }
    previousLine = line.text;
  }
  if (blocks[blocks.length - 1]?.kind === "gap") {
    blocks.pop();
  }

  const first = lines[titleIndex];
  const trimmed = first.text.trim();
  const leading = first.text.length - first.text.trimStart().length;
  return { title: [{ text: trimmed, offset: first.offset + leading }], blocks };
}

export function displayDocument(text: string): DisplayDocument {
  const laid = displayPieces(text);
  if (laid.title === null) {
    return { title: null, blocks: [] };
  }
  return {
    title: piecesText(laid.title),
    blocks: laid.blocks.map((block): DisplayBlock => (block.kind === "gap" ? block : { kind: "line", text: piecesText(block.pieces) })),
  };
}
