import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { ShownAlert } from "@/pages/alerts";
import { numberPages, type NumberedPage } from "@/pages/pages";
import type { StoredRendering } from "@/render/api";
import { getMirrorStore, readsForSignedIn } from "./mirror";
import { isOnline } from "./network";
import { isSynced, readAlerts, readLibrary, readNotebook, readPage, readRendering } from "./library";
import type { AccountStore } from "./store";

type Reader<T> = (store: AccountStore) => Promise<T | undefined>;

async function readStore<T>(read: Reader<T>): Promise<T | undefined> {
  const store = getMirrorStore();
  if (store === null || !store.isOpen()) {
    return undefined;
  }
  try {
    if (!(await readsForSignedIn(store))) {
      return undefined;
    }
    return await read(store);
  } catch {
    return undefined;
  }
}

export async function viaCache<T>(request: () => Promise<T>, read: Reader<T>): Promise<T> {
  if (!isOnline()) {
    const cached = await readStore(read);
    if (cached !== undefined) {
      return cached;
    }
  }
  try {
    return await request();
  } catch (error) {
    const cached = await readStore(read);
    if (cached !== undefined) {
      return cached;
    }
    throw error;
  }
}

export const cachedNotebooks: Reader<NotebookSummary[]> = async (store) =>
  (await isSynced(store, "notebooks")) ? (await readLibrary(store)).notebooks : undefined;

export const cachedChapters: Reader<ChapterSummary[]> = async (store) =>
  (await isSynced(store, "chapters")) ? (await readLibrary(store)).chapters : undefined;

export const cachedPages: Reader<NumberedPage[]> = async (store) =>
  (await isSynced(store, "pages")) ? numberPages((await readLibrary(store)).pages) : undefined;

export function cachedNotebook(id: string): Reader<NotebookSummary | null> {
  return async (store) => (await readNotebook(store, id)) ?? undefined;
}

export function cachedPage(id: string): Reader<NumberedPage | null> {
  return async (store) => (await readPage(store, id)) ?? undefined;
}

export function cachedAlerts(id: string): Reader<ShownAlert[]> {
  return async (store) => (await readAlerts(store, id)) ?? [];
}

export function cachedRendering(id: string): Reader<StoredRendering | null> {
  return (store) => readRendering(store, id);
}
