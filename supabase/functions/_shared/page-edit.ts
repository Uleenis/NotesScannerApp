import { UUID } from "./http.ts";
import type { EditedGap, EditedWord } from "./ports.ts";

export const MAX_BODY_CHARS = 2_000_000;
export const MAX_TEXT_UNITS = 200_000;
export const MAX_WORDS = 2_000;
export const MAX_GAPS = 20_001;
export const MAX_WORD_UNITS = 200;

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const unsafe = (text: string): boolean => text.includes(String.fromCharCode(0)) || LONE_SURROGATE.test(text);

export type PageEdit = { pageId: string; text: string; words: EditedWord[]; gaps: EditedGap[] };

const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function exactly(entry: unknown, keys: readonly [string, string]): entry is Record<string, unknown> {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const found = Object.keys(entry);
  return found.length === keys.length && keys.every((key) => found.includes(key));
}

function wordsFrom(value: unknown): EditedWord[] | null {
  if (!Array.isArray(value) || value.length > MAX_WORDS) return null;
  const seen = new Set<number>();
  const words: EditedWord[] = [];
  for (const entry of value) {
    if (!exactly(entry, ["token_index", "text"])) return null;
    const index = entry.token_index;
    const text = entry.text;
    if (!isIndex(index) || typeof text !== "string" || text.length > MAX_WORD_UNITS || Array.from(text).length > 100 || unsafe(text) || seen.has(index)) return null;
    seen.add(index);
    words.push({ token_index: index, text });
  }
  return words;
}

function gapsFrom(value: unknown, limit: number): EditedGap[] | null {
  if (!Array.isArray(value) || value.length > MAX_GAPS) return null;
  const seen = new Set<number>();
  const gaps: EditedGap[] = [];
  let total = 0;
  for (const entry of value) {
    if (!exactly(entry, ["gap_index", "text"])) return null;
    const index = entry.gap_index;
    const text = entry.text;
    if (!isIndex(index) || typeof text !== "string" || unsafe(text) || seen.has(index)) return null;
    total += text.length;
    if (total > limit) return null;
    seen.add(index);
    gaps.push({ gap_index: index, text });
  }
  return gaps;
}

export async function editFrom(request: Request): Promise<PageEdit | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_CHARS) return null;
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return null;
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const given = body as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.length !== 4 || !["page_id", "text", "words", "gaps"].every((key) => keys.includes(key))) return null;
  const pageId = given.page_id;
  const text = given.text;
  if (typeof pageId !== "string" || !UUID.test(pageId) || typeof text !== "string" || text.length > MAX_TEXT_UNITS || unsafe(text)) return null;
  const words = wordsFrom(given.words);
  const gaps = gapsFrom(given.gaps, text.length);
  if (words === null || gaps === null) return null;
  return { pageId: pageId.toLowerCase(), text, words, gaps };
}
