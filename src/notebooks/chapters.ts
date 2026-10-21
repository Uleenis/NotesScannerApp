import type { SupabaseClient } from "@supabase/supabase-js";

import { field } from "@/capture/api";

export type ChapterSummary = { id: string; notebookId: string; name: string; pageCount: number };

export type CreateChapterResult =
  | { status: "created"; chapter: ChapterSummary }
  | { status: "empty" }
  | { status: "duplicate"; name: string }
  | { status: "failed" };

export type RenameChapterResult =
  | { status: "renamed"; chapter: ChapterSummary }
  | { status: "empty" }
  | { status: "duplicate"; name: string }
  | { status: "failed" };

export type ChapterClient = Pick<SupabaseClient, "from">;

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function readPageCount(pages: unknown): number {
  const count = Array.isArray(pages) ? field(pages[0], "count") : undefined;
  return typeof count === "number" ? count : 0;
}

function readChapter(value: unknown): ChapterSummary | null {
  const id = field(value, "id");
  const notebookId = field(value, "notebook_id");
  const name = field(value, "name");
  if (typeof id !== "string" || typeof notebookId !== "string" || typeof name !== "string") {
    return null;
  }
  return { id, notebookId, name, pageCount: readPageCount(field(value, "pages")) };
}

function readNextPosition(rows: unknown): number | null {
  if (!Array.isArray(rows)) {
    return null;
  }
  if (rows.length === 0) {
    return 0;
  }
  const last = field(rows[0], "position");
  return typeof last === "number" ? last + 1 : null;
}

export async function listChapters(client: ChapterClient): Promise<ChapterSummary[]> {
  const { data, error } = await client
    .from("chapters")
    .select("id, notebook_id, name, position, pages(count)")
    .not("pages.uploaded_at", "is", null)
    .order("notebook_id")
    .order("position")
    .order("id");
  const chapters = Array.isArray(data) ? data.map(readChapter) : null;
  if (error || chapters === null || chapters.includes(null)) {
    throw new Error("The chapters could not be loaded.");
  }
  return chapters.filter((chapter) => chapter !== null);
}

export async function createChapter(client: ChapterClient, notebookId: string, rawName: string): Promise<CreateChapterResult> {
  const name = rawName.trim();
  if (name === "") {
    return { status: "empty" };
  }
  try {
    const last = await client
      .from("chapters")
      .select("position")
      .eq("notebook_id", notebookId)
      .order("position", { ascending: false })
      .limit(1);
    const position = last.error ? null : readNextPosition(last.data);
    if (position === null) {
      return { status: "failed" };
    }
    const inserted = await client.from("chapters").insert({ notebook_id: notebookId, name, position }).select("id, notebook_id, name").single();
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      return { status: "duplicate", name };
    }
    if (inserted.error?.code === CHECK_VIOLATION) {
      return { status: "empty" };
    }
    const chapter = inserted.error ? null : readChapter(inserted.data);
    return chapter === null ? { status: "failed" } : { status: "created", chapter };
  } catch {
    return { status: "failed" };
  }
}

export async function renameChapter(client: ChapterClient, id: string, rawName: string): Promise<RenameChapterResult> {
  const name = rawName.trim();
  if (name === "") {
    return { status: "empty" };
  }
  try {
    const updated = await client.from("chapters").update({ name }).eq("id", id).select("id, notebook_id, name").single();
    if (updated.error?.code === UNIQUE_VIOLATION) {
      return { status: "duplicate", name };
    }
    if (updated.error?.code === CHECK_VIOLATION) {
      return { status: "empty" };
    }
    const chapter = updated.error ? null : readChapter(updated.data);
    return chapter === null ? { status: "failed" } : { status: "renamed", chapter };
  } catch {
    return { status: "failed" };
  }
}
