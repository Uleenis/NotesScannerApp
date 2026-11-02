import { getMirrorStore, readsForSignedIn } from "./mirror";
import { openPhoto } from "./page-photos";
import { openQueuedPhoto } from "./queue";
import { eraseViewFile, writeViewFile } from "./view";

export type LocalPhoto = { uri: string; release: () => void };

export async function openLocalPhoto(pageId: string): Promise<LocalPhoto> {
  const store = getMirrorStore();
  if (store === null || !store.isOpen() || !(await readsForSignedIn(store))) {
    throw new Error("photo_unavailable");
  }
  const opened = await openPhoto(store, pageId);
  if (opened.status !== "ok") {
    throw new Error("photo_unavailable");
  }
  const file = writeViewFile(opened.bytes);
  return { uri: file.uri, release: () => eraseViewFile(file) };
}

export async function openLocalQueuedPhoto(id: string): Promise<LocalPhoto> {
  const store = getMirrorStore();
  if (store === null || !store.isOpen() || !(await readsForSignedIn(store))) {
    throw new Error("photo_unavailable");
  }
  const opened = await openQueuedPhoto(store, id);
  if (opened.status !== "ok") {
    throw new Error("photo_unavailable");
  }
  const file = writeViewFile(opened.bytes);
  return { uri: file.uri, release: () => eraseViewFile(file) };
}
