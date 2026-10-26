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

type Styled = { text: string; bold: boolean; italic: boolean };

type Marks = { open: string; close: string; placeholder: RegExp };

const FIRST_PRIVATE = 0xe000;
const LAST_PRIVATE = 0xf8fe;
const BOLD = 1;
const ITALIC = 2;
const LINE_MARK = /^( {0,4})(?:(#{1,3})|([-*+])|(\d{1,3})\.)[ \t]+/;
const PASSES = [
  { pattern: /\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*/g, length: 2, flag: BOLD },
  { pattern: /(?<![\p{L}\p{N}*])\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*(?![\p{L}\p{N}*])/gu, length: 1, flag: ITALIC },
  { pattern: /(?<![\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, length: 1, flag: ITALIC },
] as const;

function freeMarks(text: string): Marks | null {
  for (let code = FIRST_PRIVATE; code <= LAST_PRIVATE; code += 2) {
    const open = String.fromCharCode(code);
    const close = String.fromCharCode(code + 1);
    if (!text.includes(open) && !text.includes(close)) {
      return { open, close, placeholder: new RegExp(`${open}(\\d+)${close}`, "g") };
    }
  }
  return null;
}

function masked(text: string, marks: Marks): { text: string; formulas: Formula[] } {
  const formulas: Formula[] = [];
  let result = "";
  for (const piece of mathPieces(text)) {
    if (piece.kind === "text") {
      result += piece.text;
    } else {
      result += `${marks.open}${formulas.push({ display: piece.kind === "display", tex: piece.tex, source: piece.source }) - 1}${marks.close}`;
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

function styledRuns(text: string): Styled[] {
  let characters = text.split("");
  let flags: number[] = new Array<number>(characters.length).fill(0);
  for (const pass of PASSES) {
    const current = characters.join("");
    const nextCharacters: string[] = [];
    const nextFlags: number[] = [];
    const keep = (from: number, to: number, flag: number) => {
      for (let at = from; at < to; at += 1) {
        nextCharacters.push(characters[at]);
        nextFlags.push(flags[at] | flag);
      }
    };
    let at = 0;
    for (const found of current.matchAll(pass.pattern)) {
      const inner = found.index + pass.length;
      keep(at, found.index, 0);
      keep(inner, inner + found[1].length, pass.flag);
      at = found.index + found[0].length;
    }
    keep(at, characters.length, 0);
    characters = nextCharacters;
    flags = nextFlags;
  }
  const runs: Styled[] = [];
  characters.forEach((character, at) => {
    const last = runs[runs.length - 1];
    const bold = (flags[at] & BOLD) !== 0;
    const italic = (flags[at] & ITALIC) !== 0;
    if (last !== undefined && last.bold === bold && last.italic === italic) {
      last.text += character;
    } else {
      runs.push({ text: character, bold, italic });
    }
  });
  return runs;
}

function pushText(run: Styled, marks: Marks, out: Piece[], formulas: Formula[]): void {
  let at = 0;
  const push = (plain: string) => {
    if (plain !== "") {
      out.push({ kind: "text", text: plain, bold: run.bold, italic: run.italic });
    }
  };
  for (const found of run.text.matchAll(marks.placeholder)) {
    push(run.text.slice(at, found.index));
    at = found.index + found[0].length;
    const formula = formulas[Number(found[1])];
    if (formula !== undefined) {
      out.push(formula.display ? { kind: "display", tex: formula.tex, source: formula.source } : { kind: "formula", tex: formula.tex, source: formula.source });
    }
  }
  push(run.text.slice(at));
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

function blocksOf(unit: Unit, marks: Marks, formulas: Formula[]): RichBlock[] {
  const pieces: Piece[] = [];
  for (const run of styledRuns(unit.text)) {
    pushText(run, marks, pieces, formulas);
  }
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
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const marks = freeMarks(normalized);
  if (marks === null) {
    return null;
  }
  const { text, formulas } = masked(normalized, marks);
  const blocks = unitsOf(text).flatMap((unit) => blocksOf(unit, marks, formulas));
  return blocks.map((block, at): RichBlock => (block.kind === "item" && block.depth === 1 && blocks[at - 1]?.kind !== "item" ? { ...block, depth: 0 } : block));
}
