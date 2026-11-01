import { getSupabase } from "@/lib/supabase";
import { throughMirror } from "@/offline/through";
import { readRendering, renderPage, type RenderOutcome, type StoredRendering } from "./api";

export type RenderService = {
  read: (pageId: string) => Promise<StoredRendering | null>;
  render: (pageId: string) => Promise<RenderOutcome>;
};

export const renderService: RenderService = {
  read: (pageId) =>
    throughMirror(
      () => readRendering(getSupabase(), pageId),
      (mirror, rendering) => mirror.rendering(pageId, rendering),
    ),
  render: (pageId) => renderPage(getSupabase(), pageId),
};
