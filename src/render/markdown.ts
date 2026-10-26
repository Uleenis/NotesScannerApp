import { mathPieces } from "@/pages/formulas";

export const MAX_RENDERING_LENGTH = 60_000;

export type RichSpan = { kind: "text"; text: string; bold: boolean; italic: boolean } | { kind: "formula"; tex: string; source: string };

export type RichBlock =
  | { kind: "heading"; level: 1 | 2 | 3; spans: RichSpan[] }
  | { kind: "item"; depth: 0 | 1; marker: number | null; spans: RichSpan[] }
  | { kind: "paragraph"; spans: RichSpan[] }
  | { kind: "display"; tex: string; source: string };

type Unit =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "item"; depth: 0 | 1; marker: number | null; text: string }
  | { kind: "paragraph"; text: string };

type Formula = { display: boolean; tex: string; source: string };

type Piece = RichSpan | { kind: "display"; tex: string; source: string };

const OPEN = "\uE000";
const CLOSE = "\uE001";
const PRIVATE = /[\uE000\uE001]/g;
const PLACEHOLDER = /\uE000(\d+)\uE001/g;
const LINE_MARK = /^( {0,4})(?:(#{1,3})|([-*+])|(\d{1,3})\.)[ \t]+/;
const BOTH = /\*\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*\*/;
const BOLD = /\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*/;
const STAR = /(?<![\p{L}\p{N}*])\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*(?![\p{L}\p{N}*])/u;
const UNDERSCORE = /(?<![\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/u;
const EMPHASES = [
  { pattern: BOTH, bold: true, italic: true },
  { pattern: BOLD, bold: true, italic: false },
  { pattern: STAR, bold: false, italic: true },
  { pattern: UNDERSCORE, bold: false, italic: true },
] as const;

function masked(text: string): { text: string; formulas: Formula[] } {
  const formulas: Formula[] = [];
  let result = "";
  for (const piece of mathPieces(text)) {
    if (piece.kind === "text") {
      result += piece.text.replace(PRIVATE, "\uFFFD");
    } else {
      result += `${OPEN}${formulas.push({ display: piece.kind === "display", tex: piece.tex, source: piece.source }) - 1}${CLOSE}`;
    }
  }
  return { text: result, formulas };
}

function unitsOf(text: string): Unit[] {
  const units: Unit[] = [];
  let first: { kind: "item"; depth: 0 | 1; marker: number | null } | null = null;
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0) {
      units.push({ ...(first ?? { kind: "paragraph" }), text: lines.join(" ") } as Unit);
    }
    first = null;
    lines = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      close();
      continue;
    }
    const mark = LINE_MARK.exec(line);
    if (mark === null) {
      lines.push(line);
      continue;
    }
    close();
    const rest = line.slice(mark[0].length);
    if (mark[2] !== undefined) {
      units.push({ kind: "heading", level: mark[2].length as 1 | 2 | 3, text: rest });
      continue;
    }
    first = { kind: "item", depth: mark[1].length >= 2 ? 1 : 0, marker: mark[4] === undefined ? null : Number(mark[4]) };
    lines.push(rest);
  }
  close();
  return units;
}

function emphasize(text: string, bold: boolean, italic: boolean, out: Piece[], formulas: Formula[]): void {
  let rest = text;
  while (rest !== "") {
    let best: { index: number; length: number; inner: string; bold: boolean; italic: boolean } | null = null;
    for (const emphasis of EMPHASES) {
      const found = emphasis.pattern.exec(rest);
      if (found !== null && (best === null || found.index < best.index)) {
        best = { index: found.index, length: found[0].length, inner: found[1], bold: emphasis.bold, italic: emphasis.italic };
      }
    }
    if (best === null) {
      pushText(rest, bold, italic, out, formulas);
      return;
    }
    pushText(rest.slice(0, best.index), bold, italic, out, formulas);
    emphasize(best.inner, bold || best.bold, italic || best.italic, out, formulas);
    rest = rest.slice(best.index + best.length);
  }
}

function pushText(text: string, bold: boolean, italic: boolean, out: Piece[], formulas: Formula[]): void {
  let at = 0;
  const push = (plain: string) => {
    if (plain !== "") {
      out.push({ kind: "text", text: plain, bold, italic });
    }
  };
  for (const found of text.matchAll(PLACEHOLDER)) {
    push(text.slice(at, found.index));
    at = found.index + found[0].length;
    const formula = formulas[Number(found[1])];
    if (formula !== undefined) {
      out.push(formula.display ? { kind: "display", tex: formula.tex, source: formula.source } : { kind: "formula", tex: formula.tex, source: formula.source });
    }
  }
  push(text.slice(at));
}

function tidy(spans: RichSpan[]): RichSpan[] {
  const cleaned = spans.flatMap((span): RichSpan[] => (span.kind === "text" ? [{ ...span, text: span.text.replace(/\s+/g, " ") }] : [span]));
  const first = cleaned[0];
  if (first?.kind === "text") {
    cleaned[0] = { ...first, text: first.text.trimStart() };
  }
  const last = cleaned[cleaned.length - 1];
  if (last?.kind === "text") {
    cleaned[cleaned.length - 1] = { ...last, text: last.text.trimEnd() };
  }
  return cleaned.filter((span) => span.kind !== "text" || span.text !== "");
}

function blocksOf(unit: Unit, formulas: Formula[]): RichBlock[] {
  const pieces: Piece[] = [];
  emphasize(unit.text, false, false, pieces, formulas);
  const blocks: RichBlock[] = [];
  let spans: RichSpan[] = [];
  let leading = true;
  const flush = () => {
    const kept = tidy(spans);
    spans = [];
    if (kept.length === 0) {
      return;
    }
    if (!leading || unit.kind === "paragraph") {
      blocks.push({ kind: "paragraph", spans: kept });
    } else if (unit.kind === "heading") {
      blocks.push({ kind: "heading", level: unit.level, spans: kept });
    } else {
      blocks.push({ kind: "item", depth: unit.depth, marker: unit.marker, spans: kept });
    }
    leading = false;
  };
  for (const piece of pieces) {
    if (piece.kind === "display") {
      flush();
      blocks.push(piece);
      leading = false;
    } else {
      spans.push(piece);
    }
  }
  flush();
  return blocks;
}

export function parseRendering(markdown: string): RichBlock[] | null {
  if (markdown.length > MAX_RENDERING_LENGTH) {
    return null;
  }
  const { text, formulas } = masked(markdown.replace(/\r\n?/g, "\n"));
  return unitsOf(text).flatMap((unit) => blocksOf(unit, formulas));
}
