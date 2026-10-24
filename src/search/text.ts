export type ExcerptParts = { before: string; match: string; after: string };

export type WordReplacement = { word: string; suggestion: string };

const QUERY_WORD = /[\p{L}\p{N}]+/gu;

export function excerptParts(excerpt: string, start: number | null, end: number | null): ExcerptParts {
  const points = Array.from(excerpt);
  if (start === null || end === null || start < 0 || end <= start || end > points.length) {
    return { before: excerpt, match: "", after: "" };
  }
  return {
    before: points.slice(0, start).join(""),
    match: points.slice(start, end).join(""),
    after: points.slice(end).join(""),
  };
}

export function normalizeWord(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function replaceWords(query: string, replacements: readonly WordReplacement[]): string {
  const byWord = new Map(replacements.map((replacement) => [replacement.word, replacement.suggestion]));
  return query.replace(QUERY_WORD, (found) => byWord.get(normalizeWord(found)) ?? found);
}
