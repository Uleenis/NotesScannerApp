import { useSyncExternalStore } from "react";

export type QueueNotices = { lost: number; rejected: number };

const NONE: QueueNotices = { lost: 0, rejected: 0 };

let version = 0;
let notices: QueueNotices = NONE;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function announceQueue(): void {
  version += 1;
  emit();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function queueVersion(): number {
  return version;
}

export function useQueueVersion(): number {
  return useSyncExternalStore(subscribeQueue, queueVersion, queueVersion);
}

export function getNotices(): QueueNotices {
  return notices;
}

function bump(change: Partial<QueueNotices>): void {
  notices = { ...notices, ...change };
  emit();
}

export function noteLost(count: number): void {
  if (Number.isInteger(count) && count > 0) {
    bump({ lost: notices.lost + count });
  }
}

export function noteRejected(count: number): void {
  if (Number.isInteger(count) && count > 0) {
    bump({ rejected: notices.rejected + count });
  }
}

export function dismissNotices(): void {
  if (notices !== NONE) {
    notices = NONE;
    emit();
  }
}

export function useNotices(): QueueNotices {
  return useSyncExternalStore(subscribeQueue, getNotices, getNotices);
}
