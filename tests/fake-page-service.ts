import type { NumberedPage, SetTypeResult, StartResult } from "@/pages/pages";
import { pageService } from "@/pages/service";
import type { EditedGap, EditedWord, EditResult } from "@/pages/edit";
import { isWord, suggestionsFor, type ChosenFrom, type CorrectionRecord, type CorrectResult, type GapRecord, type PageWords, type WordRecord } from "@/pages/words";
import { histoire } from "./fake-notebook-service";

export const timing = {
  PAGE_POLL_MS: 20,
  LIST_POLL_MS: 20,
  WORDS_POLL_MS: 20,
  WORDS_POLL_MAX: 30,
  ALERTS_POLL_MS: 20,
  ALERTS_POLL_MAX: 3,
  CAPTURE_GRACE_MS: 60,
  STROKE_CYCLE_MS: 40,
  MAX_FADE_WAIT_MS: 10,
  FADE_MS: 5,
  STROKE_DRAW_MS: 24,
};

const THIS_YEAR = new Date().getFullYear();

export const localMoment = (month: number, day: number, hour: number, minute: number, secondsAgo = 0) =>
  new Date(new Date(THIS_YEAR, month, day, hour, minute).getTime() - secondsAgo * 1000).toISOString();

export const TITLE = "Fernand de Magellan";

export const TEXT = [TITLE, "", "Nationalité: Portugaise", "Projet -> atteindre les Indes orientales,", "dont iles Moluques", "en Indonésie.", "Mort -> 27/04/1521", "$S = \\{0 ; 4\\}$"].join("\n");

export const GLUED = "Projet -> atteindre les Indes orientales, dont iles Moluques en Indonésie.";

export function page(overrides: Partial<NumberedPage> = {}): NumberedPage {
  return {
    id: "page-1",
    notebookId: histoire.id,
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: localMoment(8, 26, 14, 32),
    uploadedAt: localMoment(8, 26, 14, 32, -5),
    attemptedAt: null,
    text: TEXT,
    pageType: "text",
    number: 4,
    ...overrides,
  };
}

export const photoAddress = (pageId: string) => `https://photos.test/${pageId}.jpg`;

export function installFakePages(initial: NumberedPage[] = []) {
  const store: NumberedPage[] = [...initial];

  jest.mocked(pageService.list).mockReset().mockImplementation(async () => store.map((stored) => ({ ...stored })));
  jest
    .mocked(pageService.get)
    .mockReset()
    .mockImplementation(async (id) => {
      const found = store.find((stored) => stored.id === id);
      return found === undefined ? null : { ...found };
    });
  jest.mocked(pageService.photoUrl).mockReset().mockImplementation(async (_userId, pageId) => photoAddress(pageId));
  jest.mocked(pageService.startReading).mockReset().mockResolvedValue({ status: "read" } satisfies StartResult);
  jest
    .mocked(pageService.setPageType)
    .mockReset()
    .mockImplementation(async (id, pageType): Promise<SetTypeResult> => {
      const index = store.findIndex((stored) => stored.id === id);
      store[index] = { ...store[index], pageType };
      return { status: "done", pageType };
    });

  jest.mocked(pageService.words).mockReset().mockResolvedValue({ words: [], corrections: [], gaps: [] });
  jest.mocked(pageService.correct).mockReset().mockResolvedValue({ status: "saved" });
  jest.mocked(pageService.edit).mockReset().mockResolvedValue({ status: "saved" });
  jest.mocked(pageService.alerts).mockReset().mockResolvedValue([]);

  return {
    store,
    change(id: string, changes: Partial<NumberedPage>) {
      const index = store.findIndex((stored) => stored.id === id);
      store[index] = { ...store[index], ...changes };
    },
  };
}

export function wordsOf(raw: string, readings: Record<number, Partial<WordRecord>> = {}): WordRecord[] {
  return [...raw.matchAll(/\S+/gu)].map((found, index) => {
    const start = Array.from(raw.slice(0, found.index)).length;
    return {
      index,
      line: raw.slice(0, found.index).split("\n").length - 1,
      text: found[0],
      readingA: null,
      readingB1: found[0],
      readingB2: null,
      start,
      end: start + Array.from(found[0]).length,
      ...readings[index],
    };
  });
}

const WORD = /\[\?\]|[0-9A-Za-z\u00c0-\u024f\u0300-\u036f'\u2019\u2018\u00b4\u02bc\-\u2010-\u2015]+/gu;
const NOT_A_LETTER = /['\u2019\u2018\u00b4\u02bc\-\u2010-\u2015\u0300-\u036f]/gu;

export function regexWordsOf(raw: string): WordRecord[] {
  const found: WordRecord[] = [];
  for (const match of raw.matchAll(WORD)) {
    if (match[0] !== "[?]" && match[0].replace(NOT_A_LETTER, "") === "") {
      continue;
    }
    const start = Array.from(raw.slice(0, match.index)).length;
    found.push({
      index: found.length,
      line: raw.slice(0, match.index).split("\n").length - 1,
      text: match[0],
      readingA: null,
      readingB1: match[0],
      readingB2: null,
      start,
      end: start + Array.from(match[0]).length,
    });
  }
  return found;
}

function rebuilt(raw: string, words: WordRecord[], corrections: CorrectionRecord[], gaps: GapRecord[]): string {
  const points = Array.from(raw);
  const gap = new Map(gaps.map((entry) => [entry.index, entry.text]));
  let text = "";
  let at = 0;
  words.forEach((word, rank) => {
    const last = corrections
      .filter((correction) => correction.tokenIndex === word.index)
      .reduce<CorrectionRecord | null>((best, correction) => (best === null || correction.revision > best.revision ? correction : best), null);
    const start = word.start ?? 0;
    const end = word.end ?? 0;
    const shown = last !== null ? last.text : word.text !== word.readingB1 ? word.text : points.slice(start, end).join("");
    text += (gap.get(rank) ?? points.slice(at, start).join("")) + shown;
    at = end;
  });
  return text + (gap.get(words.length) ?? points.slice(at).join(""));
}

function rawGaps(raw: string, words: WordRecord[]): string[] {
  const points = Array.from(raw);
  const found: string[] = [];
  let at = 0;
  for (const word of words) {
    found.push(points.slice(at, word.start ?? 0).join(""));
    at = word.end ?? 0;
  }
  found.push(points.slice(at).join(""));
  return found;
}

export function installFakeWords(pages: ReturnType<typeof installFakePages>, pageId: string, raw: string, words: WordRecord[]) {
  const corrections: CorrectionRecord[] = [];
  const gaps: GapRecord[] = [];
  const written: { tokenIndex: number; text: string; chosenFrom: ChosenFrom }[] = [];
  const edits: { text: string; words: EditedWord[]; gaps: EditedGap[] }[] = [];
  const current = pages.store.find((stored) => stored.id === pageId);
  pages.change(pageId, { text: rebuilt(raw, words, corrections, gaps) });
  if (current === undefined) {
    throw new Error("No such page.");
  }

  jest.mocked(pageService.words).mockImplementation(
    async (id): Promise<PageWords> => ({ words: id === pageId ? words : [], corrections: id === pageId ? [...corrections] : [], gaps: id === pageId ? [...gaps] : [] }),
  );
  jest.mocked(pageService.correct).mockImplementation(async (id, tokenIndex, text, chosenFrom): Promise<CorrectResult> => {
    const word = words.find((entry) => entry.index === tokenIndex);
    const reading = word === undefined ? undefined : chosenFrom === "keyboard" ? text : suggestionsFor(word).find((suggestion) => suggestion.source === chosenFrom)?.text;
    if (id !== pageId || word === undefined || !isWord(text) || reading !== text) {
      return { status: "refused" };
    }
    written.push({ tokenIndex, text, chosenFrom });
    corrections.push({ tokenIndex, revision: corrections.filter((correction) => correction.tokenIndex === tokenIndex).length + 1, text });
    pages.change(pageId, { text: rebuilt(raw, words, corrections, gaps) });
    return { status: "saved" };
  });
  jest.mocked(pageService.edit).mockImplementation(async (id, text, sentWords, sentGaps): Promise<EditResult> => {
    edits.push({ text, words: sentWords, gaps: sentGaps });
    const before = { corrections: corrections.length, gaps: gaps.map((entry) => ({ ...entry })) };
    for (const sent of sentWords) {
      corrections.push({ tokenIndex: sent.token_index, revision: corrections.filter((correction) => correction.tokenIndex === sent.token_index).length + 1, text: sent.text });
    }
    const originals = rawGaps(raw, words);
    for (const sent of sentGaps) {
      const at = gaps.findIndex((entry) => entry.index === sent.gap_index);
      if (at >= 0) {
        gaps.splice(at, 1);
      }
      if (sent.text !== originals[sent.gap_index]) {
        gaps.push({ index: sent.gap_index, text: sent.text });
      }
    }
    if (id !== pageId || rebuilt(raw, words, corrections, gaps) !== text) {
      corrections.length = before.corrections;
      gaps.splice(0, gaps.length, ...before.gaps);
      return { status: "changed" };
    }
    pages.change(pageId, { text });
    return { status: "saved" };
  });

  return { corrections, gaps, written, edits };
}
