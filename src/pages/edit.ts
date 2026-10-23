import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { looksLikeNetworkFailure, refusalCode } from "@/capture/api";
import type { PagesClient } from "./pages";
import { isWord, type PlacedWord } from "./words";

export const MAX_EDIT_CHARACTERS = 100_000;

const MAX_EDITED_WORDS = 2_000;
const MAX_DIFFERENCES = 1_000;

const WORD = /\[\?\]|[0-9A-Za-z\u00c0-\u024f\u0300-\u036f'\u2019\u2018\u00b4\u02bc\-\u2010-\u2015]+/gu;
const NOT_A_LETTER = /['\u2019\u2018\u00b4\u02bc\-\u2010-\u2015\u0300-\u036f]/gu;

export type EditedWord = { token_index: number; text: string };

export type EditedGap = { gap_index: number; text: string };

export type AlignResult = { status: "same" } | { status: "refused" } | { status: "edit"; words: EditedWord[]; gaps: EditedGap[] };

export type EditResult = { status: "saved" } | { status: "changed" } | { status: "refused" } | { status: "network" } | { status: "error" };

type Found = { text: string; start: number; end: number };

type Span = { start: number; end: number };

const STICKY_WORD = new RegExp(WORD.source, "uy");
const WORD_CHARACTER = new RegExp("^" + WORD.source.slice(WORD.source.indexOf("|") + 1, -1) + "$", "u");
const REGULAR_WORD = new RegExp("^(?:" + WORD.source + ")$", "u");

const isOdd = (word: string): boolean => !REGULAR_WORD.test(word) || (word !== "[?]" && word.replace(NOT_A_LETTER, "") === "");

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

function wordsOf(text: string, odd: string[]): Found[] {
  const byFirst = new Map<string, string[]>();
  for (const word of [...new Set(odd)].sort((a, b) => b.length - a.length)) {
    byFirst.set(word[0], [...(byFirst.get(word[0]) ?? []), word]);
  }
  const found: Found[] = [];
  let at = 0;
  while (at < text.length) {
    const odds = byFirst.get(text[at]);
    const oddWord = odds?.find(
      (word) =>
        text.startsWith(word, at) &&
        !(isWordCharacter(text[at]) && isWordCharacter(text[at - 1])) &&
        !(isWordCharacter(word[word.length - 1]) && isWordCharacter(text[at + word.length])),
    );
    if (oddWord !== undefined) {
      found.push({ text: oddWord, start: at, end: at + oddWord.length });
      at += oddWord.length;
      continue;
    }
    STICKY_WORD.lastIndex = at;
    const match = STICKY_WORD.exec(text);
    if (match === null) {
      at += 1;
      continue;
    }
    if (match[0] === "[?]" || match[0].replace(NOT_A_LETTER, "") !== "") {
      found.push({ text: match[0], start: at, end: at + match[0].length });
    }
    at += match[0].length;
  }
  return found;
}

function matches(eq: (i: number, j: number) => boolean, n: number, m: number): [number, number][] | null {
  if (n + m === 0) {
    return [];
  }
  const limit = Math.min(n + m, MAX_DIFFERENCES);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(x, y)) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(offset - d - 1, offset + d + 2));
  }
  if (found < 0) {
    return null;
  }

  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const before = trace[d - 1];
    const k = x - y;
    const previousK = k === -d || (k !== d && before[k - 1 + d] < before[k + 1 + d]) ? k + 1 : k - 1;
    const previousX = before[previousK + d];
    const previousY = previousX - previousK;
    const middleX = previousK === k + 1 ? previousX : previousX + 1;
    const middleY = previousK === k + 1 ? previousY + 1 : previousY;
    while (x > middleX && y > middleY) {
      x -= 1;
      y -= 1;
      pairs.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    pairs.push([x, y]);
  }
  return pairs.reverse();
}

export function alignEdit(shown: string, placed: PlacedWord[], edited: string, hidden: ReadonlySet<number> = new Set()): AlignResult {
  if (edited === shown) {
    return { status: "same" };
  }
  if (Array.from(edited).length > MAX_EDIT_CHARACTERS) {
    return { status: "refused" };
  }

  const count = placed.length;
  const live = placed.map((_, at) => at).filter((at) => placed[at].shown !== "" && !hidden.has(placed[at].word.index));
  const found = wordsOf(
    edited,
    live.map((at) => placed[at].shown).filter(isOdd),
  );

  const pairs = matches((i, j) => placed[live[i]].shown === found[j].text, live.length, found.length);
  if (pairs === null) {
    return { status: "refused" };
  }

  const spans: (Span | null)[] = placed.map(() => null);
  let previousI = 0;
  let previousJ = 0;
  for (const [i, j] of [...pairs, [live.length, found.length] as [number, number]]) {
    const holeD = i - previousI;
    const holeN = j - previousJ;
    for (let k = 0; k < Math.min(holeD, holeN); k += 1) {
      const target = found[previousJ + k];
      if (isWord(target.text)) {
        spans[live[previousI + k]] = { start: target.start, end: target.end };
      }
    }
    if (i < live.length) {
      spans[live[i]] = { start: found[j].start, end: found[j].end };
    }
    previousI = i + 1;
    previousJ = j + 1;
  }

  const before = (at: number): number => (at === 0 ? 0 : placed[at - 1].end);
  const after = (at: number): number => (at === count ? shown.length : placed[at].start);
  const oldGaps = Array.from({ length: count + 1 }, (_, at) => shown.slice(before(at), after(at)));

  let at = 0;
  let cursor = 0;
  while (at < count) {
    const span = spans[at];
    if (span !== null) {
      if (span.start < cursor) {
        return { status: "refused" };
      }
      cursor = span.end;
      at += 1;
      continue;
    }
    let last = at;
    while (last + 1 < count && spans[last + 1] === null) {
      last += 1;
    }
    let next = last + 1;
    while (next < count && spans[next] === null) {
      next += 1;
    }
    const limit = next < count ? (spans[next] as Span).start : edited.length;
    if (limit < cursor) {
      return { status: "refused" };
    }
    const between = edited.slice(cursor, limit);
    const kept = oldGaps.slice(at, last + 2).join("");
    let point = cursor;
    for (let hole = at; hole <= last; hole += 1) {
      if (between === kept) {
        point += oldGaps[hole].length;
      }
      spans[hole] = { start: point, end: point };
    }
    at = last + 1;
  }

  const words: EditedWord[] = [];
  const gaps: EditedGap[] = [];
  let rebuilt = "";
  let end = 0;
  for (let r = 0; r <= count; r += 1) {
    const start = r === count ? edited.length : (spans[r] as Span).start;
    if (start < end) {
      return { status: "refused" };
    }
    const gap = edited.slice(end, start);
    rebuilt += gap;
    if (gap !== oldGaps[r]) {
      gaps.push({ gap_index: r, text: gap });
    }
    if (r === count) {
      break;
    }
    const span = spans[r] as Span;
    const word = edited.slice(span.start, span.end);
    rebuilt += word;
    end = span.end;
    if (word !== placed[r].shown) {
      if (word !== "" && !isWord(word)) {
        return { status: "refused" };
      }
      words.push({ token_index: placed[r].word.index, text: word });
    }
  }
  if (rebuilt !== edited || words.length > MAX_EDITED_WORDS) {
    return { status: "refused" };
  }
  return { status: "edit", words, gaps };
}

export async function editPage(client: PagesClient, pageId: string, edited: string, words: EditedWord[], gaps: EditedGap[]): Promise<EditResult> {
  try {
    const { data, error } = await client.functions.invoke("edit-page", { body: { page_id: pageId, text: edited, words, gaps } });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error instanceof FunctionsHttpError) {
      return (await refusalCode(error)) === "text_changed" ? { status: "changed" } : { status: "refused" };
    }
    const done = typeof data === "object" && data !== null && (data as Record<string, unknown>).edited === true;
    return error || !done ? { status: "error" } : { status: "saved" };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "error" };
  }
}
