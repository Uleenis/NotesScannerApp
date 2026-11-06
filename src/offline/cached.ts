import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { ShownAlert } from "@/pages/alerts";
import { numberPages, type NumberedPage } from "@/pages/pages";
import type { StoredRendering } from "@/render/api";
import { getMirrorStore, readsForSignedIn } from "./mirror";
import { isOnline, subscribeToNetwork } from "./network";
import { isSynced, readAlerts, readLibrary, readNotebook, readPage, readRendering } from "./library";
import type { AccountStore } from "./store";
import { subscribeToStore } from "./store-ready";

type Reader<T> = (store: AccountStore) => Promise<T | undefined>;

export function isStoreOpen(): boolean {
  return getMirrorStore()?.isOpen() === true;
}

export async function readStore<T>(read: Reader<T>): Promise<T | undefined> {
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

function watchOffline<T>(read: Reader<T>): { found: Promise<T>; stop: () => void } {
  let stop: () => void = () => undefined;
  const found = new Promise<T>((resolve) => {
    const look = () => {
      if (isOnline()) {
        return;
      }
      void readStore(read).then((cached) => {
        if (cached !== undefined && !isOnline()) {
          resolve(cached);
        }
      });
    };
    const leaveNetwork = subscribeToNetwork(look);
    const leaveStore = subscribeToStore(look);
    stop = () => {
      leaveNetwork();
      leaveStore();
    };
    look();
  });
  return { found, stop };
}

async function askServer<T>(request: () => Promise<T>, read: Reader<T>): Promise<T> {
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

function forOneAccount<T>(read: Reader<T>): Reader<T> {
  let owner = getMirrorStore()?.userId ?? null;
  return async (store) => {
    owner ??= store.userId;
    return store.userId === owner ? read(store) : undefined;
  };
}

export async function viaCache<T>(request: () => Promise<T>, read: Reader<T>): Promise<T> {
  const mine = forOneAccount(read);
  if (!isOnline()) {
    const cached = await readStore(mine);
    if (cached !== undefined) {
      return cached;
    }
  }
  const offline = watchOffline(mine);
  try {
    return await Promise.race([askServer(request, mine), offline.found]);
  } finally {
    offline.stop();
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
