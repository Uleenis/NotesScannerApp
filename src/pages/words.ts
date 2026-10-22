import { field, looksLikeNetworkFailure } from "@/capture/api";
import type { PagesClient } from "./pages";

export type WordRecord = {
  index: number;
  line: number;
  text: string;
  readingA: string | null;
  readingB1: string;
  readingB2: string | null;
  start: number | null;
  end: number | null;
};

export type CorrectionRecord = { tokenIndex: number; revision: number; text: string };

export type GapRecord = { index: number; text: string };

export type PageWords = { words: WordRecord[]; corrections: CorrectionRecord[]; gaps: GapRecord[] };

export type Source = "A" | "B1" | "B2";

export type ChosenFrom = Source | "keyboard";

export type Suggestion = { source: Source; text: string };

export type PlacedWord = {
  word: WordRecord;
  start: number;
  end: number;
  shown: string;
  suggestions: Suggestion[];
};

export type CorrectResult = { status: "saved" } | { status: "refused" } | { status: "network" } | { status: "error" };

const ROWS_PER_READ = 1000;
const MAX_READS = 20;
const MAX_WORD_LENGTH = 100;

const TOKEN_COLUMNS = "token_index, line_index, text, reading_a, reading_b1, reading_b2, b1_start, b1_end";
const CORRECTION_COLUMNS = "token_index, revision, corrected_text";
const GAP_COLUMNS = "gap_index, text";

const FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0001, 0x0020],
  [0x007f, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
];

const hex = (code: number): string => "\\u" + code.toString(16).padStart(4, "0");

const NOT_IN_A_WORD = new RegExp(`[${FORBIDDEN_RANGES.map(([low, high]) => `${hex(low)}-${hex(high)}`).join("")}]`, "u");

export function isWord(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 1 && length <= MAX_WORD_LENGTH && !NOT_IN_A_WORD.test(value);
}

export function suggestionsFor(word: WordRecord): Suggestion[] {
  const readings: [Source, string | null][] = [
    ["A", word.readingA],
    ["B1", word.readingB1],
    ["B2", word.readingB2],
  ];
  const suggestions: Suggestion[] = [];
  for (const [source, text] of readings) {
    if (text !== null && text !== "" && !suggestions.some((suggestion) => suggestion.text === text)) {
      suggestions.push({ source, text });
    }
  }
  return suggestions;
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("A word could not be read.");
  }
  return value;
}

function readWord(row: unknown): WordRecord {
  const index = field(row, "token_index");
  const line = field(row, "line_index");
  const text = field(row, "text");
  const readingB1 = field(row, "reading_b1");
  const start = field(row, "b1_start") ?? null;
  const end = field(row, "b1_end") ?? null;
  const place = start === null && end === null ? { start: null, end: null } : isIndex(start) && isIndex(end) && end > start ? { start, end } : null;
  if (
    !isIndex(index) ||
    !isIndex(line) ||
    typeof text !== "string" ||
    typeof readingB1 !== "string" ||
    readingB1 === "" ||
    place === null
  ) {
    throw new Error("A word could not be read.");
  }
  return {
    index,
    line,
    text,
    readingA: optionalText(field(row, "reading_a")),
    readingB1,
    readingB2: optionalText(field(row, "reading_b2")),
    start: place.start,
    end: place.end,
  };
}

function readCorrection(row: unknown): CorrectionRecord {
  const tokenIndex = field(row, "token_index");
  const revision = field(row, "revision");
  const text = field(row, "corrected_text");
  if (!isIndex(tokenIndex) || !isIndex(revision) || typeof text !== "string") {
    throw new Error("A correction could not be read.");
  }
  return { tokenIndex, revision, text };
}

function readGap(row: unknown): GapRecord {
  const index = field(row, "gap_index");
  const text = field(row, "text");
  if (!isIndex(index) || typeof text !== "string") {
    throw new Error("A gap could not be read.");
  }
  return { index, text };
}

async function readAll(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let at = 0; at < MAX_READS; at += 1) {
    const { data, error } = await read(at * ROWS_PER_READ, (at + 1) * ROWS_PER_READ - 1);
    if (error || !Array.isArray(data)) {
      throw new Error("The words could not be loaded.");
    }
    rows.push(...data);
    if (data.length < ROWS_PER_READ) {
      return rows;
    }
  }
  throw new Error("The page has too many words.");
}

export async function listWords(client: PagesClient, pageId: string): Promise<PageWords> {
  const words = await readAll((from, to) =>
    client.from("page_tokens").select(TOKEN_COLUMNS).eq("page_id", pageId).order("token_index").range(from, to),
  );
  const corrections = await readAll((from, to) =>
    client.from("corrections").select(CORRECTION_COLUMNS).eq("page_id", pageId).order("token_index").order("revision").range(from, to),
  );
  const gaps = await readAll((from, to) => client.from("page_gaps").select(GAP_COLUMNS).eq("page_id", pageId).order("gap_index").range(from, to));
  return { words: words.map(readWord), corrections: corrections.map(readCorrection), gaps: gaps.map(readGap) };
}

export function placeWords(text: string, data: PageWords): PlacedWord[] | null {
  const points = Array.from(text);
  const units: number[] = [];
  let unit = 0;
  for (const point of points) {
    units.push(unit);
    unit += point.length;
  }
  units.push(unit);

  const latest = new Map<number, CorrectionRecord>();
  for (const correction of data.corrections) {
    const current = latest.get(correction.tokenIndex);
    if (current === undefined || correction.revision > current.revision) {
      latest.set(correction.tokenIndex, correction);
    }
  }
  const known = new Set(data.words.map((word) => word.index));
  if (known.size !== data.words.length || [...latest.keys()].some((index) => !known.has(index))) {
    return null;
  }

  const gapAt = new Map<number, string>();
  for (const gap of data.gaps) {
    if (gapAt.has(gap.index)) {
      return null;
    }
    gapAt.set(gap.index, gap.text);
  }
  const ordered = [...data.words].sort((a, b) => a.index - b.index);
  if ([...gapAt.keys()].some((index) => index > ordered.length)) {
    return null;
  }

  const placed: PlacedWord[] = [];
  let cursor = 0;
  let rawEnd = 0;
  for (const [at, word] of ordered.entries()) {
    if (word.start === null || word.end === null || word.start < rawEnd) {
      return null;
    }
    const before = gapAt.get(at);
    const gapLength = before === undefined ? word.start - rawEnd : Array.from(before).length;
    if (before !== undefined && points.slice(cursor, cursor + gapLength).join("") !== before) {
      return null;
    }
    const correction = latest.get(word.index);
    const rewritten = correction !== undefined ? correction.text : word.text !== word.readingB1 ? word.text : null;
    const length = rewritten === null ? word.end - word.start : Array.from(rewritten).length;
    const start = cursor + gapLength;
    const end = start + length;
    if (end > points.length) {
      return null;
    }
    const shown = points.slice(start, end).join("");
    if ((rewritten !== null && shown !== rewritten) || (rewritten === null && /\s/u.test(shown))) {
      return null;
    }
    placed.push({ word, start: units[start], end: units[end], shown, suggestions: suggestionsFor(word) });
    cursor = end;
    rawEnd = word.end;
  }
  const tail = gapAt.get(ordered.length);
  if (tail !== undefined && points.slice(cursor).join("") !== tail) {
    return null;
  }
  return placed;
}

export async function addCorrection(client: PagesClient, pageId: string, tokenIndex: number, text: string, chosenFrom: ChosenFrom): Promise<CorrectResult> {
  if (!isWord(text)) {
    return { status: "refused" };
  }
  try {
    const { error } = await client
      .from("corrections")
      .insert({ page_id: pageId, token_index: tokenIndex, corrected_text: text, chosen_from: chosenFrom, from_queue: false });
    if (!error) {
      return { status: "saved" };
    }
    if (looksLikeNetworkFailure(error)) {
      return { status: "network" };
    }
    const code = field(error, "code");
    return typeof code === "string" && code.startsWith("23") ? { status: "refused" } : { status: "error" };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "error" };
  }
}
