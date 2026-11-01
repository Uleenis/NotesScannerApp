import { getSupabase } from "@/lib/supabase";
import { listChapters } from "@/notebooks/chapters";
import { listNotebooks } from "@/notebooks/notebooks";
import { listPages } from "@/pages/pages";
import { fetchPagePhoto } from "./fetch-photo";
import type { SyncDeps } from "./sync";

const SIGNED_SECONDS = 600;

export async function signedInUser(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

export function defaultSyncDeps(userId: string, canDownload: () => boolean): SyncDeps {
  const client = getSupabase();
  return {
    notebooks: () => listNotebooks(client),
    chapters: () => listChapters(client),
    pages: () => listPages(client),
    fetchPhoto: (pageId) =>
      fetchPagePhoto(
        {
          signedUrl: async (path) => {
            const { data, error } = await client.storage.from("photos").createSignedUrl(path, SIGNED_SECONDS);
            if (error || data === null || typeof data.signedUrl !== "string") {
              throw error ?? new Error("The photo could not be reached.");
            }
            return data.signedUrl;
          },
          fetch: (input, init) => fetch(input, init),
        },
        userId,
        pageId,
      ),
    canDownload,
  };
}
