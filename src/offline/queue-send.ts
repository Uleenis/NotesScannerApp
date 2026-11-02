import type { SendResult } from "@/capture/send-page";
import { keepPhoto } from "./page-photos";
import { openQueuedPhoto, readQueue, removeQueued, updateQueued, type QueuedPage } from "./queue";
import { noteRejected } from "./queue-state";
import type { AccountStore } from "./store";

export type TargetCheck = { status: "ok"; chapterId: string | null } | { status: "notebook" } | { status: "network" };

export type QueueSendInput = {
  entry: QueuedPage;
  bytes: Uint8Array;
  chapterId: string | null;
  capturedAt: string;
  onCreated: (pageId: string) => Promise<void>;
};

export type QueueSendDeps = {
  now: () => number;
  targets: (notebookId: string, chapterId: string | null) => Promise<TargetCheck>;
  send: (input: QueueSendInput) => Promise<SendResult>;
  refresh: (pageId: string) => void;
};

export type QueueRun = { sent: number; rejected: number; stop: "limit" | "network" | null };

const running = new WeakMap<AccountStore, Promise<QueueRun>>();

function boundedMoment(capturedAt: string, now: number): string {
  const taken = Date.parse(capturedAt);
  return Number.isNaN(taken) || taken > now ? new Date(now).toISOString() : new Date(taken).toISOString();
}

async function run(store: AccountStore, deps: QueueSendDeps): Promise<QueueRun> {
  const result: QueueRun = { sent: 0, rejected: 0, stop: null };
  try {
    for (const entry of await readQueue(store)) {
      if (!store.isOpen()) {
        break;
      }
      const target = await deps.targets(entry.notebookId, entry.chapterId);
      if (target.status === "network") {
        result.stop = "network";
        break;
      }
      if (target.status === "notebook") {
        if (entry.blocked !== "notebook") {
          await updateQueued(store, entry.id, { blocked: "notebook" });
        }
        continue;
      }
      const opened = await openQueuedPhoto(store, entry.id);
      if (opened.status === "missing") {
        await removeQueued(store, entry.id);
        result.rejected += 1;
        continue;
      }
      if (opened.status === "refused") {
        continue;
      }
      if (entry.blocked === "notebook") {
        await updateQueued(store, entry.id, { blocked: null });
      }
      let answer: SendResult;
      try {
        answer = await deps.send({
          entry,
          bytes: opened.bytes,
          chapterId: target.chapterId,
          capturedAt: boundedMoment(entry.capturedAt, deps.now()),
          onCreated: (pageId) => updateQueued(store, entry.id, { pageId }),
        });
      } catch {
        continue;
      }
      if (answer.status === "sent") {
        await keepPhoto(store, answer.pageId, opened.bytes).catch(() => undefined);
        await removeQueued(store, entry.id);
        result.sent += 1;
        deps.refresh(answer.pageId);
      } else if (answer.status === "limit") {
        await updateQueued(store, entry.id, { blocked: answer.reason, ...(answer.pageId === entry.pageId ? {} : { pageId: answer.pageId }) });
        result.stop = "limit";
        break;
      } else if (answer.status === "photo" || answer.status === "tooLarge") {
        await removeQueued(store, entry.id);
        result.rejected += 1;
      } else if (answer.status === "network") {
        result.stop = "network";
        break;
      }
    }
  } catch {
    return result;
  } finally {
    noteRejected(result.rejected);
  }
  return result;
}

export function sendQueue(store: AccountStore, deps: QueueSendDeps): Promise<QueueRun> {
  const current = running.get(store);
  if (current !== undefined) {
    return current;
  }
  const started = store.isOpen() ? run(store, deps) : Promise.resolve<QueueRun>({ sent: 0, rejected: 0, stop: null });
  running.set(store, started);
  void started.then(() => {
    if (running.get(store) === started) {
      running.delete(store);
    }
  });
  return started;
}
