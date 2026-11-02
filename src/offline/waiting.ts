import type { QueuedPage } from "./queue";

function newestFirst(list: QueuedPage[]): QueuedPage[] {
  return [...list].reverse();
}

export function waitingOutsideChapters(list: QueuedPage[], notebookId: string, chapterIds: ReadonlySet<string>): QueuedPage[] {
  return newestFirst(list.filter((entry) => entry.notebookId === notebookId && (entry.chapterId === null || !chapterIds.has(entry.chapterId))));
}

export function waitingInChapter(list: QueuedPage[], chapterId: string): QueuedPage[] {
  return newestFirst(list.filter((entry) => entry.chapterId === chapterId));
}

export function waitingWithoutNotebook(list: QueuedPage[], notebookIds: ReadonlySet<string>): QueuedPage[] {
  return newestFirst(list.filter((entry) => !notebookIds.has(entry.notebookId)));
}
