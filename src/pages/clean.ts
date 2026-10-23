import type { PlacedWord } from "./words";

const UNDERLINE = /<\/?u>/g;
const MAX_LINE_PAIRS = 1_000_000;

type Span = { start: number; end: number };

type Cut = { text: string; at: (position: number) => number };

export type CleanView = { text: string; words: PlacedWord[]; hidden: ReadonlySet<number> };

export function stripUnderline(text: string): string {
  return text.replace(UNDERLINE, "");
}

function underlineSpans(text: string): Span[] {
  return [...text.matchAll(UNDERLINE)].map((found) => ({ start: found.index, end: found.index + found[0].length }));
}

function cut(text: string, spans: Span[]): Cut {
  let kept = "";
  let from = 0;
  for (const span of spans) {
    kept += text.slice(from, span.start);
    from = span.end;
  }
  kept += text.slice(from);
  return {
    text: kept,
    at: (position) => {
      let removed = 0;
      for (const span of spans) {
        if (span.end <= position) {
          removed += span.end - span.start;
        } else if (span.start < position) {
          return span.start - removed;
        } else {
          break;
        }
      }
      return position - removed;
    },
  };
}

type Line = { text: string; start: number };

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  const separator = /\r?\n/g;
  let from = 0;
  for (let found = separator.exec(text); found !== null; found = separator.exec(text)) {
    lines.push({ text: text.slice(from, found.index), start: from });
    from = found.index + found[0].length;
  }
  lines.push({ text: text.slice(from), start: from });
  return lines;
}

const isBlank = (line: string): boolean => line.trim() === "";

function keyOf(line: string): string {
  return line
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function matchLines(first: string[], second: string[]): Map<number, number> | null {
  const n = first.length;
  const m = second.length;
  if (n * m > MAX_LINE_PAIRS) {
    return null;
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        first[i] !== "" && first[i] === second[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const matched = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (first[i] !== "" && first[i] === second[j]) {
      matched.set(i, j);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matched;
}

function blankRuns(text: string, second: string): Span[] {
  const lines = linesOf(text);
  const others = linesOf(second);
  const own = lines.map((_, at) => at).filter((at) => !isBlank(lines[at].text));
  const theirs = others.map((_, at) => at).filter((at) => !isBlank(others[at].text));
  if (theirs.length === 0) {
    return [];
  }
  const matched = matchLines(
    own.map((at) => keyOf(lines[at].text)),
    theirs.map((at) => keyOf(others[at].text)),
  );
  if (matched === null) {
    return [];
  }

  const spans: Span[] = [];
  for (let k = 0; k + 1 < own.length; k += 1) {
    const before = own[k];
    const after = own[k + 1];
    if (after === before + 1) {
      continue;
    }
    const upper = matched.get(k);
    const lower = matched.get(k + 1);
    if (upper === undefined || lower === undefined) {
      continue;
    }
    const between = others.slice(theirs[upper] + 1, theirs[lower]);
    if (between.some((line) => isBlank(line.text))) {
      continue;
    }
    spans.push({ start: lines[before + 1].start, end: lines[after].start });
  }
  return spans;
}

export function cleanView(text: string, placed: PlacedWord[], second: string | null): CleanView {
  const tags = underlineSpans(text);
  const tagless = cut(text, tags);
  const blanks = second === null ? [] : blankRuns(tagless.text, stripUnderline(second));
  const tight = cut(tagless.text, blanks);
  const born = placed.filter((word) => tags.some((tag) => word.start >= tag.start && word.end <= tag.end));
  const words = placed
    .filter((word) => !born.includes(word))
    .map((word) => ({ ...word, start: tight.at(tagless.at(word.start)), end: tight.at(tagless.at(word.end)) }));
  return { text: tight.text, words, hidden: new Set(born.map((word) => word.word.index)) };
}
