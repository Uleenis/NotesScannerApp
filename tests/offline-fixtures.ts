import type { ChapterSummary } from "@/notebooks/chapters";
import type { NotebookSummary } from "@/notebooks/notebooks";
import type { PageRecord } from "@/pages/pages";

export const USER = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";
export const OTHER_USER = "7d2e4f6a-8b1c-4d3e-a5f7-9b1d3f5a7c9e";

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function notebook(n: number, name = `Notebook ${n}`): NotebookSummary {
  return { id: uuid(100 + n), name, pageCount: 0 };
}

export function chapter(n: number, notebookNumber: number, name = `Chapter ${n}`): ChapterSummary {
  return { id: uuid(200 + n), notebookId: uuid(100 + notebookNumber), name, pageCount: 0 };
}

export function page(n: number, notebookNumber: number, extra: Partial<PageRecord> = {}): PageRecord {
  const day = String(1 + (n % 27)).padStart(2, "0");
  return {
    id: uuid(300 + n),
    notebookId: uuid(100 + notebookNumber),
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: `2026-10-${day}T10:00:00.000Z`,
    uploadedAt: `2026-10-${day}T10:05:00.000Z`,
    attemptedAt: null,
    text: `Text of page ${n}`,
    pageType: "text",
    ...extra,
  };
}

export function jpeg(size = 2048, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + seed * 7) % 256;
  }
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}
