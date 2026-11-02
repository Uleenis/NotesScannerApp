import { getMirrorStore } from "./mirror";
import { readQueue } from "./queue";
import { dismissNotices } from "./queue-state";
import type { OfflineSession } from "./session";
import { countWaitingFiles, wipeAccountStore } from "./store";

let session: OfflineSession | null = null;

export function setOfflineSession(next: OfflineSession | null): void {
  session = next;
}

function filesWaiting(userId: string): number {
  try {
    return countWaitingFiles(userId);
  } catch {
    return 0;
  }
}

export async function waitingPages(userId: string): Promise<number> {
  const store = getMirrorStore();
  if (store !== null && store.userId === userId && store.isOpen()) {
    try {
      return Math.max((await readQueue(store)).length, filesWaiting(userId));
    } catch {
      return filesWaiting(userId);
    }
  }
  return filesWaiting(userId);
}

export async function leaveAccount(userId: string): Promise<void> {
  try {
    if (session !== null) {
      await session.leave(userId);
    } else {
      await wipeAccountStore(userId);
    }
  } catch {
    await Promise.resolve();
  }
  dismissNotices();
}
