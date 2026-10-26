import { getSupabase } from "@/lib/supabase";
import { readRendering, renderPage, type RenderOutcome, type StoredRendering } from "./api";

export type RenderService = {
  read: (pageId: string) => Promise<StoredRendering | null>;
  render: (pageId: string) => Promise<RenderOutcome>;
};

export const renderService: RenderService = {
  read: (pageId) => readRendering(getSupabase(), pageId),
  render: (pageId) => renderPage(getSupabase(), pageId),
};
