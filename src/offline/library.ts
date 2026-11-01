import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { PageRecord } from "@/pages/pages";
import type { ShownAlert } from "@/pages/alerts";
import type { StoredRendering } from "@/render/api";
import { checkedUuid } from "./bytes";
import { deleteWhereIn, removePhotoFiles } from "./page-photos";
import type { AccountStore } from "./store";
import { inWrite } from "./writes";

export type CachedLibrary = { notebooks: NotebookSummary[]; chapters: ChapterSummary[]; pages: PageRecord[] };

type Database = AccountStore["database"];

export const LIST_CAP = 1000;
export const ORPHAN_GRACE_MS = 10 * 60_000;

const STATUSES: readonly string[] = ["queued", "processing", "read", "failed"];
const QUEUE_REASONS: readonly string[] = ["read_error", "offline"];
const PAGE_TYPES: readonly string[] = ["text", "math", "unsupported_script"];
const ALERTS: readonly string[] = ["date_incoherent", "missing_line", "math_incomplete"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function asNotebook(value: unknown): NotebookSummary | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.pageCount !== "number") {
    return null;
  }
  return { id: value.id, name: value.name, pageCount: value.pageCount };
}

function asChapter(value: unknown): ChapterSummary | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.notebookId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.pageCount !== "number"
  ) {
    return null;
  }
  return { id: value.id, notebookId: value.notebookId, name: value.name, pageCount: value.pageCount };
}

function asPage(value: unknown): PageRecord | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.notebookId !== "string" ||
    (value.chapterId !== null && typeof value.chapterId !== "string") ||
    typeof value.status !== "string" ||
    !STATUSES.includes(value.status) ||
    (value.queueReason !== null && (typeof value.queueReason !== "string" || !QUEUE_REASONS.includes(value.queueReason))) ||
    typeof value.capturedAt !== "string" ||
    typeof value.uploadedAt !== "string" ||
    (value.attemptedAt !== null && typeof value.attemptedAt !== "string") ||
    (value.text !== null && typeof value.text !== "string") ||
    typeof value.pageType !== "string" ||
    !PAGE_TYPES.includes(value.pageType)
  ) {
    return null;
  }
  return {
    id: value.id,
    notebookId: value.notebookId,
    chapterId: value.chapterId as string | null,
    status: value.status as PageRecord["status"],
    queueReason: value.queueReason as PageRecord["queueReason"],
    capturedAt: value.capturedAt,
    uploadedAt: value.uploadedAt,
    attemptedAt: value.attemptedAt as string | null,
    text: value.text as string | null,
    pageType: value.pageType as PageRecord["pageType"],
  };
}

function storedNotebook(notebook: NotebookSummary): NotebookSummary {
  return { id: checkedUuid(notebook.id), name: notebook.name, pageCount: notebook.pageCount };
}

function storedChapter(chapter: ChapterSummary): ChapterSummary {
  return { id: checkedUuid(chapter.id), notebookId: checkedUuid(chapter.notebookId), name: chapter.name, pageCount: chapter.pageCount };
}

function storedPage(page: PageRecord): PageRecord {
  return {
    id: checkedUuid(page.id),
    notebookId: checkedUuid(page.notebookId),
    chapterId: page.chapterId === null ? null : checkedUuid(page.chapterId),
    status: page.status,
    queueReason: page.queueReason,
    capturedAt: page.capturedAt,
    uploadedAt: page.uploadedAt,
    attemptedAt: page.attemptedAt,
    text: page.text,
    pageType: page.pageType,
  };
}

async function insertNotebook(database: Database, notebook: NotebookSummary): Promise<void> {
  await database.runAsync("insert into notebooks (id, data) values (?, ?) on conflict (id) do update set data = excluded.data", [
    notebook.id,
    JSON.stringify(notebook),
  ]);
}

async function insertChapter(database: Database, chapter: ChapterSummary): Promise<void> {
  await database.runAsync(
    "insert into chapters (id, notebook_id, data) values (?, ?, ?) on conflict (id) do update set notebook_id = excluded.notebook_id, data = excluded.data",
    [chapter.id, chapter.notebookId, JSON.stringify(chapter)],
  );
}

async function insertPage(database: Database, page: PageRecord): Promise<void> {
  await database.runAsync(
    "insert into pages (id, notebook_id, chapter_id, data) values (?, ?, ?, ?) on conflict (id) do update set notebook_id = excluded.notebook_id, chapter_id = excluded.chapter_id, data = excluded.data",
    [page.id, page.notebookId, page.chapterId, JSON.stringify(page)],
  );
}

async function forgetPages(store: AccountStore, ids: string[]): Promise<void> {
  await deleteWhereIn(store, "pages", "id", ids);
  await deleteWhereIn(store, "page_alerts", "page_id", ids);
  await deleteWhereIn(store, "page_renderings", "page_id", ids);
  await deleteWhereIn(store, "photos", "page_id", ids);
}

async function forgetNotebooks(store: AccountStore, ids: string[]): Promise<string[]> {
  const pageIds: string[] = [];
  for (const id of ids) {
    const rows = await store.database.getAllAsync<{ id: string }>("select id from pages where notebook_id = ?", [id]);
    pageIds.push(...rows.map((row) => row.id));
  }
  await forgetPages(store, pageIds);
  await deleteWhereIn(store, "chapters", "notebook_id", ids);
  return pageIds;
}

async function sweepOrphans(store: AccountStore): Promise<string[]> {
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  const rows = await store.database.getAllAsync<{ page_id: string }>(
    "select page_id from photos where page_id not in (select id from pages) and opened_at < ?",
    [cutoff],
  );
  await store.database.runAsync("delete from photos where page_id not in (select id from pages) and opened_at < ?", [cutoff]);
  await store.database.runAsync("delete from page_alerts where page_id not in (select id from pages)");
  await store.database.runAsync("delete from page_renderings where page_id not in (select id from pages)");
  return rows.map((row) => row.page_id);
}

async function existingIds(store: AccountStore, table: "notebooks" | "chapters" | "pages"): Promise<string[]> {
  const rows = await store.database.getAllAsync<{ id: string }>(`select id from ${table}`);
  return rows.map((row) => row.id);
}

export async function replaceNotebooks(store: AccountStore, notebooks: NotebookSummary[]): Promise<void> {
  const records = notebooks.map(storedNotebook);
  const files = await inWrite(store, async () => {
    let erased: string[] = [];
    await store.database.withTransactionAsync(async () => {
      if (records.length < LIST_CAP) {
        const keep = new Set(records.map((record) => record.id));
        const gone = (await existingIds(store, "notebooks")).filter((id) => !keep.has(id));
        erased = await forgetNotebooks(store, gone);
        await store.database.runAsync("delete from notebooks");
      }
      for (const record of records) {
        await insertNotebook(store.database, record);
      }
    });
    return erased;
  });
  removePhotoFiles(store, files);
}

export async function replaceChapters(store: AccountStore, chapters: ChapterSummary[]): Promise<void> {
  const records = chapters.map(storedChapter);
  await inWrite(store, () =>
    store.database.withTransactionAsync(async () => {
      if (records.length < LIST_CAP) {
        await store.database.runAsync("delete from chapters");
      }
      for (const record of records) {
        await insertChapter(store.database, record);
      }
    }),
  );
}

export async function replacePages(store: AccountStore, pages: PageRecord[]): Promise<void> {
  const records = pages.map(storedPage);
  const files = await inWrite(store, async () => {
    let erased: string[] = [];
    await store.database.withTransactionAsync(async () => {
      for (const record of records) {
        await insertPage(store.database, record);
      }
      if (records.length >= LIST_CAP) {
        return;
      }
      const keep = new Set(records.map((record) => record.id));
      const gone = (await existingIds(store, "pages")).filter((id) => !keep.has(id));
      await forgetPages(store, gone);
      erased = [...gone, ...(await sweepOrphans(store))];
    });
    return erased;
  });
  removePhotoFiles(store, files);
}

export async function putNotebook(store: AccountStore, notebook: NotebookSummary): Promise<void> {
  const record = storedNotebook(notebook);
  await inWrite(store, () => insertNotebook(store.database, record));
}

export async function putChapter(store: AccountStore, chapter: ChapterSummary): Promise<void> {
  const record = storedChapter(chapter);
  await inWrite(store, () => insertChapter(store.database, record));
}

export async function putPage(store: AccountStore, page: PageRecord): Promise<void> {
  const record = storedPage(page);
  await inWrite(store, () => insertPage(store.database, record));
}

export async function dropPage(store: AccountStore, pageId: string): Promise<void> {
  const id = checkedUuid(pageId);
  const dropped = await inWrite(store, async () => {
    let photo = true;
    await store.database.withTransactionAsync(async () => {
      const recent = await store.database.getFirstAsync<{ found: number }>("select 1 as found from photos where page_id = ? and opened_at >= ?", [
        id,
        Date.now() - ORPHAN_GRACE_MS,
      ]);
      photo = recent === null;
      await deleteWhereIn(store, "pages", "id", [id]);
      await deleteWhereIn(store, "page_alerts", "page_id", [id]);
      await deleteWhereIn(store, "page_renderings", "page_id", [id]);
      if (photo) {
        await deleteWhereIn(store, "photos", "page_id", [id]);
      }
    });
    return photo;
  });
  if (dropped) {
    removePhotoFiles(store, [id]);
  }
}

export async function dropNotebook(store: AccountStore, notebookId: string): Promise<void> {
  const id = checkedUuid(notebookId);
  const files = await inWrite(store, async () => {
    let erased: string[] = [];
    await store.database.withTransactionAsync(async () => {
      erased = await forgetNotebooks(store, [id]);
      await store.database.runAsync("delete from notebooks where id = ?", [id]);
    });
    return erased;
  });
  removePhotoFiles(store, files);
}

export async function putAlerts(store: AccountStore, pageId: string, alerts: ShownAlert[]): Promise<void> {
  const id = checkedUuid(pageId);
  await inWrite(store, async () => {
    await store.database.runAsync("insert into page_alerts (page_id, data) values (?, ?) on conflict (page_id) do update set data = excluded.data", [
      id,
      JSON.stringify(alerts),
    ]);
  });
}

export async function putRendering(store: AccountStore, pageId: string, rendering: StoredRendering | null): Promise<void> {
  const id = checkedUuid(pageId);
  await inWrite(store, async () => {
    if (rendering === null) {
      await store.database.runAsync("delete from page_renderings where page_id = ?", [id]);
      return;
    }
    await store.database.runAsync(
      "insert into page_renderings (page_id, data) values (?, ?) on conflict (page_id) do update set data = excluded.data",
      [id, JSON.stringify({ text: rendering.text, basedOn: rendering.basedOn })],
    );
  });
}

export async function readAlerts(store: AccountStore, pageId: string): Promise<ShownAlert[] | null> {
  const row = await store.database.getFirstAsync<{ data: string }>("select data from page_alerts where page_id = ?", [checkedUuid(pageId)]);
  if (row === null) {
    return null;
  }
  const parsed = parse(row.data);
  return Array.isArray(parsed) ? parsed.filter((kind): kind is ShownAlert => typeof kind === "string" && ALERTS.includes(kind)) : null;
}

export async function readRendering(store: AccountStore, pageId: string): Promise<StoredRendering | null> {
  const row = await store.database.getFirstAsync<{ data: string }>("select data from page_renderings where page_id = ?", [checkedUuid(pageId)]);
  if (row === null) {
    return null;
  }
  const parsed = parse(row.data);
  if (!isObject(parsed) || typeof parsed.text !== "string" || typeof parsed.basedOn !== "string") {
    return null;
  }
  return { text: parsed.text, basedOn: parsed.basedOn };
}

async function readRows<T>(store: AccountStore, sql: string, read: (value: unknown) => T | null): Promise<T[]> {
  const rows = await store.database.getAllAsync<{ data: string }>(sql);
  const found: T[] = [];
  for (const row of rows) {
    const value = read(parse(row.data));
    if (value !== null) {
      found.push(value);
    }
  }
  return found;
}

export async function readLibrary(store: AccountStore): Promise<CachedLibrary> {
  return {
    notebooks: await readRows(store, "select data from notebooks order by rowid", asNotebook),
    chapters: await readRows(store, "select data from chapters order by rowid", asChapter),
    pages: await readRows(store, "select data from pages order by rowid", asPage),
  };
}
