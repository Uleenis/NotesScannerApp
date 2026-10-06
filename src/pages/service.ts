import { getSupabase } from "@/lib/supabase";
import { getPage, listPages, photoUrl, startReading, type NumberedPage, type StartResult } from "./pages";

export type PageService = {
  list: () => Promise<NumberedPage[]>;
  get: (id: string) => Promise<NumberedPage | null>;
  photoUrl: (userId: string, pageId: string) => Promise<string>;
  startReading: (pageId: string) => Promise<StartResult>;
};

export const pageService: PageService = {
  list: () => listPages(getSupabase()),
  get: (id) => getPage(getSupabase(), id),
  photoUrl: (userId, pageId) => photoUrl(getSupabase(), userId, pageId),
  startReading: (pageId) => startReading(getSupabase(), pageId),
};
