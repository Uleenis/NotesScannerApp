import { Directory, Paths } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

import { excludeFromBackup } from "./backup";
import { checkedUuid } from "./bytes";
import { deriveKeys } from "./cipher";
import { StoreUnreadable, openDatabase } from "./database";
import { createKey, deleteKey, readKey } from "./key";
import { countPhotos, sealedPhotos, type SealedPhotos } from "./photos";

export type AccountStore = {
  userId: string;
  database: SQLiteDatabase;
  pagePhotos: SealedPhotos;
  queuePhotos: SealedPhotos;
  close(): Promise<void>;
};

export type OpenedStore = { store: AccountStore; lostPending: number };

const stores = new Map<string, Promise<AccountStore>>();

function offlineRoot(): Directory {
  return new Directory(Paths.document, "offline");
}

function accountFolder(userId: string): Directory {
  return new Directory(offlineRoot(), checkedUuid(userId));
}

function hasContent(folder: Directory): boolean {
  return folder.exists && folder.list().length > 0;
}

async function erase(userId: string, folder: Directory): Promise<number> {
  const lost = countPhotos(folder, "queue");
  if (folder.exists) {
    folder.delete();
  }
  await deleteKey(userId);
  return lost;
}

async function build(userId: string, report: (lost: number) => void): Promise<Omit<AccountStore, "close">> {
  const folder = accountFolder(userId);
  const root = offlineRoot();
  root.create({ intermediates: true, idempotent: true });
  excludeFromBackup(root);
  const stored = await readKey(userId);
  let master: Uint8Array;
  if (stored.status === "found") {
    master = stored.key;
  } else {
    if (stored.status === "unreadable" || hasContent(folder)) {
      report(await erase(userId, folder));
    }
    master = await createKey(userId);
  }
  let keys = await deriveKeys(master);
  let database: SQLiteDatabase;
  try {
    database = await openDatabase(folder, keys.database);
  } catch (error) {
    if (!(error instanceof StoreUnreadable)) {
      throw error;
    }
    report(await erase(userId, folder));
    keys = await deriveKeys(await createKey(userId));
    database = await openDatabase(folder, keys.database);
  }
  return {
    userId,
    database,
    pagePhotos: sealedPhotos(folder, "pages", keys.photos),
    queuePhotos: sealedPhotos(folder, "queue", keys.photos),
  };
}

export async function openAccountStore(userId: string): Promise<OpenedStore> {
  checkedUuid(userId);
  const existing = stores.get(userId);
  if (existing !== undefined) {
    return { store: await existing, lostPending: 0 };
  }
  let lostPending = 0;
  const opening: Promise<AccountStore> = build(userId, (lost) => {
    lostPending += lost;
  }).then((parts) => ({
    ...parts,
    async close() {
      if (stores.get(userId) === opening) {
        stores.delete(userId);
      }
      await parts.database.closeAsync();
    },
  }));
  stores.set(userId, opening);
  try {
    return { store: await opening, lostPending };
  } catch (error) {
    if (stores.get(userId) === opening) {
      stores.delete(userId);
    }
    throw error;
  }
}

async function closeOpening(opening: Promise<AccountStore>): Promise<void> {
  try {
    const store = await opening;
    await store.close();
  } catch {
    return;
  }
}

export async function closeAccountStores(): Promise<void> {
  const openings = [...stores.values()];
  stores.clear();
  await Promise.all(openings.map(closeOpening));
}

export async function wipeAccountStore(userId: string): Promise<number> {
  const folder = accountFolder(userId);
  const opening = stores.get(userId);
  stores.delete(userId);
  if (opening !== undefined) {
    await closeOpening(opening);
  }
  return erase(userId, folder);
}
