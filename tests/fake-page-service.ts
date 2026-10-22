import type { NumberedPage, SetTypeResult, StartResult } from "@/pages/pages";
import { pageService } from "@/pages/service";
import { isWord, suggestionsFor, type ChosenFrom, type CorrectionRecord, type CorrectResult, type PageWords, type WordRecord } from "@/pages/words";
import { histoire } from "./fake-notebook-service";

export const timing = {
  PAGE_POLL_MS: 20,
  LIST_POLL_MS: 20,
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

  jest.mocked(pageService.words).mockReset().mockResolvedValue({ words: [], corrections: [] });
  jest.mocked(pageService.correct).mockReset().mockResolvedValue({ status: "saved" });

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

function rebuilt(raw: string, words: WordRecord[], corrections: CorrectionRecord[]): string {
  const points = Array.from(raw);
  let text = "";
  let at = 0;
  for (const word of words) {
    const last = corrections.filter((correction) => correction.tokenIndex === word.index).reduce<CorrectionRecord | null>((best, correction) => (best === null || correction.revision > best.revision ? correction : best), null);
    const shown = last !== null ? last.text : word.text !== word.readingB1 ? word.text : null;
    if (shown !== null && word.start !== null && word.end !== null) {
      text += points.slice(at, word.start).join("") + shown;
      at = word.end;
    }
  }
  return text + points.slice(at).join("");
}

export function installFakeWords(pages: ReturnType<typeof installFakePages>, pageId: string, raw: string, words: WordRecord[]) {
  const corrections: CorrectionRecord[] = [];
  const written: { tokenIndex: number; text: string; chosenFrom: ChosenFrom }[] = [];
  const current = pages.store.find((stored) => stored.id === pageId);
  pages.change(pageId, { text: rebuilt(raw, words, corrections) });
  if (current === undefined) {
    throw new Error("No such page.");
  }

  jest.mocked(pageService.words).mockImplementation(async (id): Promise<PageWords> => ({ words: id === pageId ? words : [], corrections: id === pageId ? [...corrections] : [] }));
  jest.mocked(pageService.correct).mockImplementation(async (id, tokenIndex, text, chosenFrom): Promise<CorrectResult> => {
    const word = words.find((entry) => entry.index === tokenIndex);
    const reading = word === undefined ? undefined : chosenFrom === "keyboard" ? text : suggestionsFor(word).find((suggestion) => suggestion.source === chosenFrom)?.text;
    if (id !== pageId || word === undefined || !isWord(text) || reading !== text) {
      return { status: "refused" };
    }
    written.push({ tokenIndex, text, chosenFrom });
    corrections.push({ tokenIndex, revision: corrections.filter((correction) => correction.tokenIndex === tokenIndex).length + 1, text });
    pages.change(pageId, { text: rebuilt(raw, words, corrections) });
    return { status: "saved" };
  });

  return { corrections, written };
}
