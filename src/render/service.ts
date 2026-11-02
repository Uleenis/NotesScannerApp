import { getSupabase } from "@/lib/supabase";
import { cachedRendering, viaCache } from "@/offline/cached";
import { throughMirror } from "@/offline/through";
import { readRendering, renderPage, type RenderOutcome, type StoredRendering } from "./api";

export type RenderService = {
  read: (pageId: string) => Promise<StoredRendering | null>;
  render: (pageId: string) => Promise<RenderOutcome>;
};

export const renderService: RenderService = {
  read: (pageId) =>
    viaCache(
      () =>
        throughMirror(
          () => readRendering(getSupabase(), pageId),
          (mirror, rendering) => mirror.rendering(pageId, rendering),
        ),
      cachedRendering(pageId),
    ),
  render: (pageId) => renderPage(getSupabase(), pageId),
};
