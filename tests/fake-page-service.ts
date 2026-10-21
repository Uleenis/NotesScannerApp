import type { NumberedPage, SetTypeResult, StartResult } from "@/pages/pages";
import { pageService } from "@/pages/service";
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

  return {
    store,
    change(id: string, changes: Partial<NumberedPage>) {
      const index = store.findIndex((stored) => stored.id === id);
      store[index] = { ...store[index], ...changes };
    },
  };
}
