import type { BlockReason } from "@/capture/allowance";
import type { PageSource } from "@/capture/api";
import { checkedUuid, isUuid } from "./bytes";
import { randomUUID } from "expo-crypto";
import { isJpeg } from "./page-photos";
import { announceQueue } from "./queue-state";
import type { OpenedPhoto } from "./photos";
import type { AccountStore } from "./store";
import { inWrite } from "./writes";

export const QUEUE_MAX = 200;

export type QueueBlock = BlockReason | "notebook";

export type QueuedPage = {
  id: string;
  notebookId: string;
  chapterId: string | null;
  source: PageSource;
  capturedAt: string;
  pageId: string | null;
  blocked: QueueBlock | null;
};

export type NewQueuedPage = Pick<QueuedPage, "notebookId" | "chapterId" | "source" | "capturedAt">;

export type QueuedChange = Partial<Pick<QueuedPage, "notebookId" | "chapterId" | "pageId" | "blocked">>;

const SOURCES: readonly string[] = ["camera", "import"];
const BLOCKS: readonly string[] = ["monthly_limit", "anonymous_limit", "anonymous_daily_cap", "notebook"];
const MOMENT_MAX = 40;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isUuid(value));
}

function asQueued(id: string, value: unknown): QueuedPage | null {
  if (
    !isUuid(id) ||
    !isObject(value) ||
    typeof value.notebookId !== "string" ||
    !isUuid(value.notebookId) ||
    !optionalUuid(value.chapterId) ||
    typeof value.source !== "string" ||
    !SOURCES.includes(value.source) ||
    typeof value.capturedAt !== "string" ||
    value.capturedAt.length > MOMENT_MAX ||
    !optionalUuid(value.pageId) ||
    (value.blocked !== null && (typeof value.blocked !== "string" || !BLOCKS.includes(value.blocked)))
  ) {
    return null;
  }
  return {
    id,
    notebookId: value.notebookId,
    chapterId: value.chapterId,
    source: value.source as PageSource,
    capturedAt: value.capturedAt,
    pageId: value.pageId,
    blocked: value.blocked as QueueBlock | null,
  };
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function stored(page: QueuedPage): string {
  return JSON.stringify({
    notebookId: page.notebookId,
    chapterId: page.chapterId,
    source: page.source,
    capturedAt: page.capturedAt,
    pageId: page.pageId,
    blocked: page.blocked,
  });
}

function checkedNew(input: NewQueuedPage): void {
  if (
    !isUuid(input.notebookId) ||
    !optionalUuid(input.chapterId) ||
    !SOURCES.includes(input.source) ||
    typeof input.capturedAt !== "string" ||
    input.capturedAt.length > MOMENT_MAX
  ) {
    throw new Error("invalid_queue_entry");
  }
}

export async function enqueuePage(store: AccountStore, input: NewQueuedPage, bytes: Uint8Array): Promise<string> {
  checkedNew(input);
  if (!isJpeg(bytes)) {
    throw new Error("photo_format");
  }
  const id = randomUUID();
  await inWrite(store, async () => {
    const counted = await store.database.getFirstAsync<{ total: number }>("select count(*) as total from queue");
    if ((counted?.total ?? 0) >= QUEUE_MAX) {
      throw new Error("queue_full");
    }
    await store.queuePhotos.save(id, bytes);
    try {
      const entry: QueuedPage = { id, ...input, pageId: null, blocked: null };
      await store.database.runAsync("insert into queue (id, rank, data) values (?, (select coalesce(max(rank), 0) + 1 from queue), ?)", [id, stored(entry)]);
    } catch (error) {
      store.queuePhotos.remove(id);
      throw error;
    }
  });
  announceQueue();
  return id;
}

export async function readQueue(store: AccountStore): Promise<QueuedPage[]> {
  const rows = await store.database.getAllAsync<{ id: string; data: string }>("select id, data from queue order by rank");
  const found: QueuedPage[] = [];
  for (const row of rows) {
    const entry = asQueued(row.id, parse(row.data));
    if (entry !== null) {
      found.push(entry);
    }
  }
  return found;
}

export async function readQueued(store: AccountStore, id: string): Promise<QueuedPage | null> {
  const row = await store.database.getFirstAsync<{ id: string; data: string }>("select id, data from queue where id = ?", [checkedUuid(id)]);
  return row === null ? null : asQueued(row.id, parse(row.data));
}

export async function updateQueued(store: AccountStore, id: string, change: QueuedChange): Promise<void> {
  const checked = checkedUuid(id);
  if (
    (change.notebookId !== undefined && !isUuid(change.notebookId)) ||
    (change.chapterId !== undefined && !optionalUuid(change.chapterId)) ||
    (change.pageId !== undefined && !optionalUuid(change.pageId)) ||
    (change.blocked !== undefined && change.blocked !== null && !BLOCKS.includes(change.blocked))
  ) {
    throw new Error("invalid_queue_entry");
  }
  await inWrite(store, async () => {
    const row = await store.database.getFirstAsync<{ id: string; data: string }>("select id, data from queue where id = ?", [checked]);
    const current = row === null ? null : asQueued(row.id, parse(row.data));
    if (current === null) {
      return;
    }
    const next: QueuedPage = {
      ...current,
      ...(change.notebookId === undefined ? {} : { notebookId: change.notebookId }),
      ...(change.chapterId === undefined ? {} : { chapterId: change.chapterId }),
      ...(change.pageId === undefined ? {} : { pageId: change.pageId }),
      ...(change.blocked === undefined ? {} : { blocked: change.blocked }),
    };
    await store.database.runAsync("update queue set data = ? where id = ?", [stored(next), checked]);
  });
  announceQueue();
}

export async function removeQueued(store: AccountStore, id: string): Promise<void> {
  const checked = checkedUuid(id);
  await inWrite(store, async () => {
    await store.database.runAsync("delete from queue where id = ?", [checked]);
    store.queuePhotos.remove(checked);
  });
  announceQueue();
}

export function openQueuedPhoto(store: AccountStore, id: string): Promise<OpenedPhoto> {
  return store.queuePhotos.open(checkedUuid(id));
}
