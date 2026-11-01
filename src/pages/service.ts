import { getSupabase } from "@/lib/supabase";
import { fetchPhotoAt } from "@/offline/fetch-photo";
import { beginMirror } from "@/offline/mirror";
import { throughMirror } from "@/offline/through";
import type { DeleteResult } from "@/notebooks/removal";
import { listAlerts, type ShownAlert } from "./alerts";
import { editPage, type EditedGap, type EditedWord, type EditResult } from "./edit";
import {
  countPages,
  deletePage,
  getPage,
  listPages,
  movePage,
  photoUrl,
  setPageType,
  startReading,
  type MoveResult,
  type NumberedPage,
  type SetTypeResult,
  type StartResult,
  type SwitchableType,
} from "./pages";
import type { PhotoSize } from "./frame";
import { readPhotoPixels } from "./photo-pixels";
import { readSecond } from "./second";
import { addCorrection, listWords, type ChosenFrom, type CorrectResult, type PageWords } from "./words";

export type PageService = {
  list: () => Promise<NumberedPage[]>;
  count: () => Promise<number>;
  get: (id: string) => Promise<NumberedPage | null>;
  photoUrl: (userId: string, pageId: string) => Promise<string>;
  photoPixels: (uri: string) => Promise<PhotoSize | null>;
  startReading: (pageId: string) => Promise<StartResult>;
  setPageType: (pageId: string, pageType: SwitchableType) => Promise<SetTypeResult>;
  move: (pageId: string, notebookId: string, chapterId: string | null) => Promise<MoveResult>;
  remove: (pageId: string) => Promise<DeleteResult>;
  words: (pageId: string) => Promise<PageWords>;
  correct: (pageId: string, tokenIndex: number, text: string, chosenFrom: ChosenFrom) => Promise<CorrectResult>;
  edit: (pageId: string, text: string, words: EditedWord[], gaps: EditedGap[]) => Promise<EditResult>;
  alerts: (pageId: string) => Promise<ShownAlert[]>;
  second: (pageId: string) => Promise<string | null>;
};

export const pageService: PageService = {
  list: () =>
    throughMirror(
      () => listPages(getSupabase()),
      (mirror, pages) => mirror.pages(pages),
    ),
  count: () => countPages(getSupabase()),
  get: (id) =>
    throughMirror(
      () => getPage(getSupabase(), id),
      (mirror, page) => mirror.page(id, page),
    ),
  photoUrl: async (userId, pageId) => {
    const mirror = beginMirror();
    const url = await photoUrl(getSupabase(), userId, pageId);
    void mirror.openedPhoto(pageId, () => fetchPhotoAt(fetch, url)).catch(() => undefined);
    return url;
  },
  photoPixels: (uri) => readPhotoPixels(uri),
  startReading: (pageId) => startReading(getSupabase(), pageId),
  setPageType: (pageId, pageType) => setPageType(getSupabase(), pageId, pageType),
  move: (pageId, notebookId, chapterId) => movePage(getSupabase(), pageId, notebookId, chapterId),
  remove: (pageId) => deletePage(getSupabase(), pageId),
  words: (pageId) => listWords(getSupabase(), pageId),
  correct: (pageId, tokenIndex, text, chosenFrom) => addCorrection(getSupabase(), pageId, tokenIndex, text, chosenFrom),
  edit: (pageId, text, words, gaps) => editPage(getSupabase(), pageId, text, words, gaps),
  alerts: (pageId) =>
    throughMirror(
      () => listAlerts(getSupabase(), pageId),
      (mirror, alerts) => mirror.alerts(pageId, alerts),
    ),
  second: (pageId) => readSecond(getSupabase(), pageId),
};
