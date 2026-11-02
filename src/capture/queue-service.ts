import { File } from "expo-file-system";

import { getSupabase } from "@/lib/supabase";
import { getMirrorStore, readsForSignedIn } from "@/offline/mirror";
import { isOnline } from "@/offline/network";
import { enqueuePage, removeQueued, updateQueued } from "@/offline/queue";
import { sendQueue, type QueueSendDeps, type TargetCheck } from "@/offline/queue-send";
import { announceQueue } from "@/offline/queue-state";
import { callPrepare, callRead, insertPage, markUploaded, uploadPhoto, type CaptureClient, type PageSource } from "./api";
import { sendPage } from "./send-page";

const SEND_TIMEOUT_MS = 120_000;

export type EnqueueInput = { notebookId: string; chapterId: string | null; photoUri: string; source: PageSource };

export type EnqueueResult = { status: "queued"; id: string } | { status: "failed" };

type TargetClient = Pick<CaptureClient, "from">;

async function exists(client: TargetClient, table: "notebooks" | "chapters", filters: [string, string][]): Promise<boolean> {
  let query = client.from(table).select("id");
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error("target_unreachable");
  }
  return data !== null;
}

export async function checkTargets(client: TargetClient, notebookId: string, chapterId: string | null): Promise<TargetCheck> {
  try {
    if (!(await exists(client, "notebooks", [["id", notebookId]]))) {
      return { status: "notebook" };
    }
    if (chapterId === null) {
      return { status: "ok", chapterId: null };
    }
    const found = await exists(client, "chapters", [
      ["id", chapterId],
      ["notebook_id", notebookId],
    ]);
    return { status: "ok", chapterId: found ? chapterId : null };
  } catch {
    return { status: "network" };
  }
}

export function realQueueDeps(): QueueSendDeps {
  const client = getSupabase();
  return {
    now: () => Date.now(),
    targets: (notebookId, chapterId) => checkTargets(client, notebookId, chapterId),
    send: ({ entry, bytes, chapterId, capturedAt, onCreated }) =>
      sendPage(
        {
          createPage: async (notebookId, _at, chapter, source) => {
            const created = await insertPage(client, notebookId, capturedAt, chapter, source);
            if (created.status === "created") {
              await onCreated(created.pageId);
            }
            return created;
          },
          preparePage: (pageId) => callPrepare(client, pageId),
          upload: (path, token) => uploadPhoto(client, path, token, bytes),
          markUploaded: (pageId, uploadedAt) => markUploaded(client, pageId, uploadedAt),
          startReading: (pageId) => {
            void callRead(client, pageId).then(announceQueue);
          },
          now: () => new Date().toISOString(),
          timeoutMs: SEND_TIMEOUT_MS,
        },
        { notebookId: entry.notebookId, chapterId, photoUri: "", pageId: entry.pageId, source: entry.source },
      ),
    refresh: announceQueue,
  };
}

export async function queuePage(input: EnqueueInput): Promise<EnqueueResult> {
  const store = getMirrorStore();
  try {
    if (store === null || !store.isOpen() || !(await readsForSignedIn(store))) {
      return { status: "failed" };
    }
    const bytes = await new File(input.photoUri).bytes();
    const id = await enqueuePage(
      store,
      { notebookId: input.notebookId, chapterId: input.chapterId, source: input.source, capturedAt: new Date().toISOString() },
      bytes,
    );
    return { status: "queued", id };
  } catch {
    return { status: "failed" };
  }
}

async function openStore() {
  const store = getMirrorStore();
  if (store === null || !store.isOpen() || !(await readsForSignedIn(store))) {
    return null;
  }
  return store;
}

export async function discardWaiting(id: string): Promise<boolean> {
  try {
    const store = await openStore();
    if (store === null) {
      return false;
    }
    await removeQueued(store, id);
    return true;
  } catch {
    return false;
  }
}

export async function chooseWaitingNotebook(id: string, notebookId: string): Promise<boolean> {
  try {
    const store = await openStore();
    if (store === null) {
      return false;
    }
    await updateQueued(store, id, { notebookId, chapterId: null, pageId: null, blocked: null });
    return true;
  } catch {
    return false;
  }
}

export async function sendWaitingNow(): Promise<void> {
  try {
    const store = await openStore();
    if (store !== null && isOnline()) {
      await sendQueue(store, realQueueDeps());
    }
  } catch {
    return;
  }
}
