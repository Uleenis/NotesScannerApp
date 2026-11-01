import { parseMoment } from "@/pages/dates";
import { checkedUuid } from "./bytes";
import { SEAL_BYTES } from "./cipher";
import type { OpenedPhoto } from "./photos";
import type { AccountStore } from "./store";
import { inWrite } from "./writes";

const MB = 1024 * 1024;

export const PHOTO_BUDGET_BYTES = 1024 * MB;
export const PHOTO_TARGET_BYTES = 900 * MB;

const CHUNK = 400;

type KeepOptions = { now?: number; evict?: boolean };

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function removePhotoFiles(store: AccountStore, ids: string[]): void {
  for (const id of ids) {
    try {
      store.pagePhotos.remove(id);
    } catch {
      continue;
    }
  }
}

export async function deleteWhereIn(
  store: AccountStore,
  table: "pages" | "page_alerts" | "page_renderings" | "photos" | "chapters",
  column: "id" | "page_id" | "notebook_id",
  ids: string[],
): Promise<void> {
  for (let start = 0; start < ids.length; start += CHUNK) {
    const part = ids.slice(start, start + CHUNK);
    await store.database.runAsync(`delete from ${table} where ${column} in (${part.map(() => "?").join(",")})`, part);
  }
}

async function total(store: AccountStore): Promise<number> {
  const row = await store.database.getFirstAsync<{ total: number }>("select coalesce(sum(bytes), 0) as total from photos");
  return row?.total ?? 0;
}

export function photoBytes(store: AccountStore): Promise<number> {
  return total(store);
}

export async function hasPhoto(store: AccountStore, pageId: string): Promise<boolean> {
  const row = await store.database.getFirstAsync<{ found: number }>("select 1 as found from photos where page_id = ?", [checkedUuid(pageId)]);
  return row !== null;
}

async function enforceBudget(store: AccountStore, protectedId: string): Promise<void> {
  await inWrite(store, async () => {
    let remaining = await total(store);
    if (remaining <= PHOTO_BUDGET_BYTES) {
      return;
    }
    const rows = await store.database.getAllAsync<{ page_id: string; bytes: number }>(
      "select page_id, bytes from photos order by opened_at asc, page_id asc",
    );
    const evicted: string[] = [];
    for (const row of rows) {
      if (remaining <= PHOTO_TARGET_BYTES) {
        break;
      }
      if (row.page_id === protectedId) {
        continue;
      }
      evicted.push(row.page_id);
      remaining -= row.bytes;
    }
    await store.database.withTransactionAsync(async () => {
      await deleteWhereIn(store, "photos", "page_id", evicted);
    });
    removePhotoFiles(store, evicted);
  });
}

export async function keepPhoto(store: AccountStore, pageId: string, bytes: Uint8Array, options: KeepOptions = {}): Promise<void> {
  const id = checkedUuid(pageId);
  if (!isJpeg(bytes)) {
    throw new Error("photo_format");
  }
  const now = options.now ?? Date.now();
  await inWrite(store, async () => {
    await store.pagePhotos.save(id, bytes);
    try {
      await store.database.runAsync(
        "insert into photos (page_id, bytes, opened_at) values (?, ?, ?) on conflict (page_id) do update set bytes = excluded.bytes, opened_at = excluded.opened_at",
        [id, bytes.length + SEAL_BYTES, now],
      );
    } catch (error) {
      removePhotoFiles(store, [id]);
      throw error;
    }
  });
  if (options.evict !== false) {
    await enforceBudget(store, id);
  }
}

export async function touchPhoto(store: AccountStore, pageId: string, now = Date.now()): Promise<boolean> {
  const id = checkedUuid(pageId);
  return inWrite(store, async () => {
    const result = await store.database.runAsync("update photos set opened_at = ? where page_id = ?", [now, id]);
    return result.changes > 0;
  });
}

export async function openPhoto(store: AccountStore, pageId: string, options: { now?: number } = {}): Promise<OpenedPhoto> {
  const id = checkedUuid(pageId);
  const opened = await store.pagePhotos.open(id);
  if (opened.status === "ok") {
    await touchPhoto(store, id, options.now);
  } else if (opened.status === "missing") {
    await inWrite(store, () => deleteWhereIn(store, "photos", "page_id", [id]));
  }
  return opened;
}

export async function dropPhotos(store: AccountStore, ids: string[]): Promise<void> {
  const checked = ids.map(checkedUuid);
  await inWrite(store, () => store.database.withTransactionAsync(() => deleteWhereIn(store, "photos", "page_id", checked)));
  removePhotoFiles(store, checked);
}

export async function photosToFetch(store: AccountStore): Promise<string[]> {
  const rows = await store.database.getAllAsync<{ id: string; data: string }>(
    "select id, data from pages where id not in (select page_id from photos)",
  );
  const dated = rows.map((row) => {
    let capturedAt = Number.NaN;
    try {
      const parsed: unknown = JSON.parse(row.data);
      if (typeof parsed === "object" && parsed !== null && "capturedAt" in parsed && typeof parsed.capturedAt === "string") {
        capturedAt = parseMoment(parsed.capturedAt);
      }
    } catch {
      capturedAt = Number.NaN;
    }
    return { id: row.id, capturedAt: Number.isNaN(capturedAt) ? 0 : capturedAt };
  });
  dated.sort((a, b) => b.capturedAt - a.capturedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return dated.map((row) => row.id);
}

export async function reconcilePhotos(store: AccountStore): Promise<void> {
  await inWrite(store, async () => {
    const files = new Set(store.pagePhotos.list());
    const rows = await store.database.getAllAsync<{ page_id: string }>("select page_id from photos");
    const indexed = new Set(rows.map((row) => row.page_id));
    removePhotoFiles(
      store,
      [...files].filter((id) => !indexed.has(id)),
    );
    const lost = [...indexed].filter((id) => !files.has(id));
    await store.database.withTransactionAsync(() => deleteWhereIn(store, "photos", "page_id", lost));
  });
}
