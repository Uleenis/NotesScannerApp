import { getSupabase } from "@/lib/supabase";
import { countPages, getPage, listPages, photoUrl, setPageType, startReading, type NumberedPage, type SetTypeResult, type StartResult, type SwitchableType } from "./pages";

export type PageService = {
  list: () => Promise<NumberedPage[]>;
  count: () => Promise<number>;
  get: (id: string) => Promise<NumberedPage | null>;
  photoUrl: (userId: string, pageId: string) => Promise<string>;
  startReading: (pageId: string) => Promise<StartResult>;
  setPageType: (pageId: string, pageType: SwitchableType) => Promise<SetTypeResult>;
};

export const pageService: PageService = {
  list: () => listPages(getSupabase()),
  count: () => countPages(getSupabase()),
  get: (id) => getPage(getSupabase(), id),
  photoUrl: (userId, pageId) => photoUrl(getSupabase(), userId, pageId),
  startReading: (pageId) => startReading(getSupabase(), pageId),
  setPageType: (pageId, pageType) => setPageType(getSupabase(), pageId, pageType),
};
