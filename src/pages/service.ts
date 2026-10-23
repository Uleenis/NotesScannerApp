import { getSupabase } from "@/lib/supabase";
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
import { readSecond } from "./second";
import { addCorrection, listWords, type ChosenFrom, type CorrectResult, type PageWords } from "./words";

export type PageService = {
  list: () => Promise<NumberedPage[]>;
  count: () => Promise<number>;
  get: (id: string) => Promise<NumberedPage | null>;
  photoUrl: (userId: string, pageId: string) => Promise<string>;
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
  list: () => listPages(getSupabase()),
  count: () => countPages(getSupabase()),
  get: (id) => getPage(getSupabase(), id),
  photoUrl: (userId, pageId) => photoUrl(getSupabase(), userId, pageId),
  startReading: (pageId) => startReading(getSupabase(), pageId),
  setPageType: (pageId, pageType) => setPageType(getSupabase(), pageId, pageType),
  move: (pageId, notebookId, chapterId) => movePage(getSupabase(), pageId, notebookId, chapterId),
  remove: (pageId) => deletePage(getSupabase(), pageId),
  words: (pageId) => listWords(getSupabase(), pageId),
  correct: (pageId, tokenIndex, text, chosenFrom) => addCorrection(getSupabase(), pageId, tokenIndex, text, chosenFrom),
  edit: (pageId, text, words, gaps) => editPage(getSupabase(), pageId, text, words, gaps),
  alerts: (pageId) => listAlerts(getSupabase(), pageId),
  second: (pageId) => readSecond(getSupabase(), pageId),
};
