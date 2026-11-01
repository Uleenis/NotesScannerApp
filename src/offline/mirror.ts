import { File } from "expo-file-system";

import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { ShownAlert } from "@/pages/alerts";
import type { PageRecord } from "@/pages/pages";
import type { StoredRendering } from "@/render/api";
import type { PhotoFetch } from "./fetch-photo";
import {
  dropNotebook,
  dropPage,
  putAlerts,
  putNotebook,
  putPage,
  putRendering,
  replaceChapters,
  replaceNotebooks,
  replacePages,
} from "./library";
import { hasPhoto, keepPhoto, touchPhoto } from "./page-photos";
import type { AccountStore } from "./store";

export type Mirror = {
  notebooks: (list: NotebookSummary[]) => Promise<void>;
  chapters: (list: ChapterSummary[]) => Promise<void>;
  pages: (list: PageRecord[]) => Promise<void>;
  notebook: (id: string, value: NotebookSummary | null) => Promise<void>;
  page: (id: string, value: PageRecord | null) => Promise<void>;
  alerts: (pageId: string, value: ShownAlert[]) => Promise<void>;
  rendering: (pageId: string, value: StoredRendering | null) => Promise<void>;
  sentPhoto: (pageId: string, photoUri: string) => Promise<void>;
  openedPhoto: (pageId: string, load: () => Promise<PhotoFetch>) => Promise<void>;
};

type ListKind = "notebooks" | "chapters" | "pages";

let current: AccountStore | null = null;
let identity: (() => Promise<string | null>) | null = null;
let tickets = 0;
const applied = new WeakMap<AccountStore, Record<ListKind, number>>();
const loading = new Map<string, Promise<void>>();

export function setMirrorStore(store: AccountStore | null): void {
  current = store;
}

export function setMirrorIdentity(read: (() => Promise<string | null>) | null): void {
  identity = read;
}

export function getMirrorStore(): AccountStore | null {
  return current;
}

function record(page: PageRecord): PageRecord {
  return {
    id: page.id,
    notebookId: page.notebookId,
    chapterId: page.chapterId,
    status: page.status,
    queueReason: page.queueReason,
    capturedAt: page.capturedAt,
    uploadedAt: page.uploadedAt,
    attemptedAt: page.attemptedAt,
    text: page.text,
    pageType: page.pageType,
  };
}

async function quietly(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    return;
  }
}

export function createMirror(store: AccountStore | null): Mirror {
  tickets += 1;
  const ticket = tickets;

  const withStore = (task: (open: AccountStore) => Promise<unknown>) =>
    store === null
      ? Promise.resolve()
      : quietly(async () => {
          if (identity !== null && (await identity()) !== store.userId) {
            return;
          }
          await task(store);
        });

  const list = (kind: ListKind, write: (open: AccountStore) => Promise<void>) =>
    withStore(async (open) => {
      const marks = applied.get(open) ?? { notebooks: 0, chapters: 0, pages: 0 };
      if (marks[kind] > ticket) {
        return;
      }
      marks[kind] = ticket;
      applied.set(open, marks);
      await write(open);
    });

  return {
    notebooks: (notebooks) => list("notebooks", (open) => replaceNotebooks(open, notebooks)),
    chapters: (chapters) => list("chapters", (open) => replaceChapters(open, chapters)),
    pages: (pages) => list("pages", (open) => replacePages(open, pages.map(record))),
    notebook: (id, value) => withStore((open) => (value === null ? dropNotebook(open, id) : putNotebook(open, value))),
    page: (id, value) => withStore((open) => (value === null ? dropPage(open, id) : putPage(open, record(value)))),
    alerts: (pageId, value) => withStore((open) => putAlerts(open, pageId, value)),
    rendering: (pageId, value) => withStore((open) => putRendering(open, pageId, value)),
    sentPhoto: (pageId, photoUri) =>
      withStore(async (open) => {
        await keepPhoto(open, pageId, await new File(photoUri).bytes());
      }),
    openedPhoto: (pageId, load) =>
      withStore(async (open) => {
        if (await touchPhoto(open, pageId)) {
          return;
        }
        const key = `${open.userId}:${pageId}`;
        const running = loading.get(key);
        if (running !== undefined) {
          return running;
        }
        const task = (async () => {
          const fetched = await load();
          if (fetched.status === "ok" && !(await hasPhoto(open, pageId))) {
            await keepPhoto(open, pageId, fetched.bytes);
          }
        })();
        const settled = quietly(() => task).then(() => {
          loading.delete(key);
        });
        loading.set(key, settled);
        return settled;
      }),
  };
}

export function beginMirror(): Mirror {
  return createMirror(current);
}
