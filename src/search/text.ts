export type ExcerptParts = { before: string; match: string; after: string };

export type WordReplacement = { word: string; suggestion: string };

const QUERY_WORD = /[\p{L}\p{N}]+/gu;
const UNDERLINE = /<\/?u>/g;
const ELLIPSIS = "\u2026";
const WHOLE_LINE = 240;
const BEFORE_MATCH = 80;
const AFTER_MATCH = 160;

const FOLDED: Readonly<Record<string, string>> = {
  "\u0153": "oe",
  "\u00e6": "ae",
  "\u00df": "ss",
  "\u00f8": "o",
  "\u0142": "l",
  "\u0111": "d",
};

function shown(excerpt: string, start: number | null, end: number | null): { points: string[]; start: number | null; end: number | null } {
  const points = Array.from(excerpt);
  const removed = new Array<boolean>(points.length).fill(false);
  for (const found of excerpt.matchAll(UNDERLINE)) {
    const from = Array.from(excerpt.slice(0, found.index)).length;
    for (let at = from; at < from + found[0].length; at += 1) {
      removed[at] = true;
    }
  }
  const kept = points.filter((_point, at) => !removed[at]);
  if (start === null || end === null || start < 0 || end <= start || end > points.length) {
    return { points: kept, start: null, end: null };
  }
  const keptBefore = (limit: number) => removed.slice(0, limit).filter((gone) => !gone).length;
  const shownStart = keptBefore(start);
  const shownEnd = keptBefore(end);
  return shownEnd > shownStart ? { points: kept, start: shownStart, end: shownEnd } : { points: kept, start: null, end: null };
}

export function excerptParts(excerpt: string, start: number | null, end: number | null): ExcerptParts {
  const line = shown(excerpt, start, end);
  if (line.start === null || line.end === null) {
    const whole = line.points.length > WHOLE_LINE ? `${line.points.slice(0, WHOLE_LINE).join("")}${ELLIPSIS}` : line.points.join("");
    return { before: whole, match: "", after: "" };
  }
  const from = line.points.length > WHOLE_LINE ? Math.max(0, line.start - BEFORE_MATCH) : 0;
  const to = line.points.length > WHOLE_LINE ? Math.min(line.points.length, line.end + AFTER_MATCH) : line.points.length;
  return {
    before: `${from > 0 ? ELLIPSIS : ""}${line.points.slice(from, line.start).join("")}`,
    match: line.points.slice(line.start, line.end).join(""),
    after: `${line.points.slice(line.end, to).join("")}${to < line.points.length ? ELLIPSIS : ""}`,
  };
}

export function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\u0153\u00e6\u00df\u00f8\u0142\u0111]/gu, (letter) => FOLDED[letter] ?? letter);
}

export function replaceWords(query: string, replacements: readonly WordReplacement[]): string {
  const byWord = new Map(replacements.map((replacement) => [replacement.word, replacement.suggestion]));
  return query.replace(QUERY_WORD, (found) => byWord.get(normalizeWord(found)) ?? found);
}
