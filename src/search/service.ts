import { getSupabase } from "@/lib/supabase";
import { readAnchor, searchPages, type Anchor, type SearchOutcome } from "./search";

export type SearchService = {
  search: (query: string, notebookId: string | null) => Promise<SearchOutcome>;
  anchor: (pageId: string, tokenIndex: number) => Promise<Anchor | null>;
};

export const searchService: SearchService = {
  search: (query, notebookId) => searchPages(getSupabase(), query, notebookId),
  anchor: (pageId, tokenIndex) => readAnchor(getSupabase(), pageId, tokenIndex),
};
