export type TextPiece = { kind: "text"; text: string };

export type InlineFormula = { kind: "inline"; tex: string; source: string };

export type DisplayFormula = { kind: "display"; tex: string; source: string };

export type FormulaPiece = InlineFormula | DisplayFormula;

export type MathPiece = TextPiece | FormulaPiece;

export type InlinePart = TextPiece | InlineFormula;

export type MathRow = { kind: "line"; parts: InlinePart[] } | DisplayFormula | { kind: "gap" };

const BACKSLASH = String.fromCharCode(92);
const ENVIRONMENT = /^[A-Za-z]+\*?$/;

type Found = { piece: FormulaPiece; end: number };

class Scanner {
  private readonly missing = new Map<string, number>();

  constructor(private readonly text: string) {}

  private closer(needle: string, from: number): number {
    const known = this.missing.get(needle);
    if (known !== undefined && from >= known) {
      return -1;
    }
    const at = this.text.indexOf(needle, from);
    if (at === -1) {
      this.missing.set(needle, Math.min(known ?? from, from));
    }
    return at;
  }

  private delimited(start: number, open: string, close: string, kind: FormulaPiece["kind"]): Found | null {
    const at = this.closer(close, start + open.length);
    if (at === -1) {
      return null;
    }
    const end = at + close.length;
    const tex = this.text.slice(start + open.length, at);
    if (tex.trim() === "") {
      return null;
    }
    return { piece: { kind, tex, source: this.text.slice(start, end) }, end };
  }

  private environment(start: number): Found | null {
    const open = `${BACKSLASH}begin{`;
    const offset = this.text.slice(start + open.length, start + 41).indexOf("}");
    if (offset === -1) {
      return null;
    }
    const nameEnd = start + open.length + offset;
    const name = this.text.slice(start + open.length, nameEnd);
    if (!ENVIRONMENT.test(name)) {
      return null;
    }
    const close = `${BACKSLASH}end{${name}}`;
    const at = this.closer(close, nameEnd + 1);
    if (at === -1) {
      return null;
    }
    const end = at + close.length;
    const source = this.text.slice(start, end);
    return { piece: { kind: "display", tex: source, source }, end };
  }

  private singleDollar(start: number): Found | null {
    const text = this.text;
    const first = text[start + 1];
    if (first === undefined || /\s|\$/.test(first)) {
      return null;
    }
    let at = start + 1;
    while (at < text.length && text[at] !== "$" && text[at] !== "\n") {
      at += text[at] === BACKSLASH && text[at + 1] === "$" ? 2 : 1;
    }
    if (text[at] !== "$" || /\s/.test(text[at - 1])) {
      return null;
    }
    const source = text.slice(start, at + 1);
    return { piece: { kind: "inline", tex: text.slice(start + 1, at), source }, end: at + 1 };
  }

  formulaAt(index: number): Found | null {
    const text = this.text;
    if (text.startsWith("$$", index)) {
      return this.delimited(index, "$$", "$$", "display");
    }
    if (text[index] === "$") {
      return this.singleDollar(index);
    }
    if (text.startsWith(`${BACKSLASH}[`, index)) {
      return this.delimited(index, `${BACKSLASH}[`, `${BACKSLASH}]`, "display");
    }
    if (text.startsWith(`${BACKSLASH}(`, index)) {
      return this.delimited(index, `${BACKSLASH}(`, `${BACKSLASH})`, "inline");
    }
    if (text.startsWith(`${BACKSLASH}begin{`, index)) {
      return this.environment(index);
    }
    return null;
  }
}

export function mathPieces(text: string): MathPiece[] {
  const scanner = new Scanner(text);
  const pieces: MathPiece[] = [];
  let plain = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === BACKSLASH && text[index + 1] === "$") {
      plain += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    const found = scanner.formulaAt(index);
    if (found === null) {
      const skip = text.startsWith("$$", index) ? 2 : 1;
      plain += text.slice(index, index + skip);
      index += skip;
      continue;
    }
    if (plain !== "") {
      pieces.push({ kind: "text", text: plain });
      plain = "";
    }
    pieces.push(found.piece);
    index = found.end;
  }
  if (plain !== "") {
    pieces.push({ kind: "text", text: plain });
  }
  return pieces;
}

export function mathRows(text: string): MathRow[] {
  const rows: MathRow[] = [];
  let parts: InlinePart[] = [];
  let pendingGap = false;
  let afterDisplay = false;

  const push = (row: MathRow) => {
    if (pendingGap && rows.length > 0) {
      rows.push({ kind: "gap" });
    }
    pendingGap = false;
    rows.push(row);
  };

  const endLine = () => {
    const blank = parts.every((part) => part.kind === "text" && part.text.trim() === "");
    if (!blank) {
      push({ kind: "line", parts });
    } else if (!afterDisplay) {
      pendingGap = true;
    }
    parts = [];
    afterDisplay = false;
  };

  for (const piece of mathPieces(text)) {
    if (piece.kind === "display") {
      if (parts.some((part) => part.kind !== "text" || part.text.trim() !== "")) {
        push({ kind: "line", parts });
      }
      parts = [];
      push({ kind: "display", tex: piece.tex, source: piece.source });
      afterDisplay = true;
      continue;
    }
    if (piece.kind === "inline") {
      parts.push({ kind: "inline", tex: piece.tex, source: piece.source });
      afterDisplay = false;
      continue;
    }
    const segments = piece.text.split("\n");
    segments.forEach((segment, position) => {
      if (position > 0) {
        endLine();
      }
      if (segment !== "") {
        parts.push({ kind: "text", text: segment });
        if (segment.trim() !== "") {
          afterDisplay = false;
        }
      }
    });
  }
  if (parts.some((part) => part.kind !== "text" || part.text.trim() !== "")) {
    push({ kind: "line", parts });
  }
  return rows;
}

export type MathDocument = { title: string | null; rows: MathRow[] };

export function mathDocument(raw: string): MathDocument {
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim() !== "");
  if (titleIndex === -1) {
    return { title: null, rows: [] };
  }
  const start = lines.slice(0, titleIndex).reduce((total, line) => total + line.length + 1, 0);
  const end = start + lines[titleIndex].length;
  let offset = 0;
  for (const piece of mathPieces(text)) {
    const length = piece.kind === "text" ? piece.text.length : piece.source.length;
    if (piece.kind !== "text" && offset < end && offset + length > start) {
      return { title: null, rows: mathRows(text) };
    }
    offset += length;
  }
  return { title: lines[titleIndex].trim(), rows: mathRows(lines.slice(titleIndex + 1).join("\n")) };
}
