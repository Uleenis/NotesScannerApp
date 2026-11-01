import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { PageRecord } from "@/pages/pages";
import type { PhotoFetch } from "./fetch-photo";
import { createMirror } from "./mirror";
import { PHOTO_TARGET_BYTES, hasPhoto, keepPhoto, photoBytes, photosToFetch, reconcilePhotos } from "./page-photos";
import type { AccountStore } from "./store";

export type SyncDeps = {
  notebooks: () => Promise<NotebookSummary[]>;
  chapters: () => Promise<ChapterSummary[]>;
  pages: () => Promise<PageRecord[]>;
  fetchPhoto: (pageId: string) => Promise<PhotoFetch>;
  canDownload: () => boolean;
};

export const SYNC_TIMEOUT_MS = 10 * 60_000;

export type SyncReport = { status: "done" | "failed"; downloaded: number };

const running = new WeakMap<AccountStore, Promise<SyncReport>>();

async function downloadPhotos(store: AccountStore, deps: SyncDeps): Promise<number> {
  let downloaded = 0;
  let wanted: string[];
  try {
    wanted = await photosToFetch(store);
  } catch {
    return 0;
  }
  const base = Date.now();
  for (const [rank, pageId] of wanted.entries()) {
    if (!store.isOpen() || !deps.canDownload()) {
      break;
    }
    try {
      if ((await photoBytes(store)) >= PHOTO_TARGET_BYTES) {
        break;
      }
      const fetched = await deps.fetchPhoto(pageId);
      if (fetched.status === "network") {
        break;
      }
      if (fetched.status === "gone" || !store.isOpen() || (await hasPhoto(store, pageId))) {
        continue;
      }
      await keepPhoto(store, pageId, fetched.bytes, { evict: false, now: base - rank });
      downloaded += 1;
    } catch {
      continue;
    }
  }
  return downloaded;
}

async function run(store: AccountStore, deps: SyncDeps): Promise<SyncReport> {
  const mirror = createMirror(store);
  let library: [NotebookSummary[], ChapterSummary[], PageRecord[]];
  try {
    library = await Promise.all([deps.notebooks(), deps.chapters(), deps.pages()]);
  } catch {
    return { status: "failed", downloaded: 0 };
  }
  await mirror.notebooks(library[0]);
  await mirror.chapters(library[1]);
  await mirror.pages(library[2]);
  try {
    await reconcilePhotos(store);
  } catch {
    return { status: "done", downloaded: 0 };
  }
  return { status: "done", downloaded: await downloadPhotos(store, deps) };
}

export function syncStore(store: AccountStore, deps: SyncDeps): Promise<SyncReport> {
  const existing = running.get(store);
  if (existing !== undefined) {
    return existing;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SyncReport>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", downloaded: 0 }), SYNC_TIMEOUT_MS);
  });
  const started: Promise<SyncReport> = Promise.race([run(store, deps), timeout]).finally(() => {
    clearTimeout(timer);
    if (running.get(store) === started) {
      running.delete(store);
    }
  });
  running.set(store, started);
  return started;
}
