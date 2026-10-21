import type { SupabaseClient } from "@supabase/supabase-js";

export type NotebookSummary = { id: string; name: string; pageCount: number };

export type CreateNotebookResult =
  | { status: "created"; notebook: NotebookSummary }
  | { status: "empty" }
  | { status: "duplicate"; name: string }
  | { status: "failed" };

export type RenameNotebookResult =
  | { status: "renamed"; notebook: NotebookSummary }
  | { status: "empty" }
  | { status: "duplicate"; name: string }
  | { status: "failed" };

export type NotebookClient = Pick<SupabaseClient, "from">;

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function readPageCount(pages: unknown): number {
  if (!Array.isArray(pages) || pages.length === 0) {
    return 0;
  }
  const first: unknown = pages[0];
  if (typeof first === "object" && first !== null && "count" in first && typeof first.count === "number") {
    return first.count;
  }
  return 0;
}

function readNotebook(value: unknown): NotebookSummary | null {
  if (typeof value !== "object" || value === null || !("id" in value) || !("name" in value)) {
    return null;
  }
  const { id, name } = value;
  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }
  return { id, name, pageCount: "pages" in value ? readPageCount(value.pages) : 0 };
}

function readNextPosition(rows: unknown): number | null {
  if (!Array.isArray(rows)) {
    return null;
  }
  if (rows.length === 0) {
    return 0;
  }
  const last: unknown = rows[0];
  if (typeof last === "object" && last !== null && "position" in last && typeof last.position === "number") {
    return last.position + 1;
  }
  return null;
}

export async function listNotebooks(client: NotebookClient): Promise<NotebookSummary[]> {
  const { data, error } = await client
    .from("notebooks")
    .select("id, name, position, pages(count)")
    .not("pages.uploaded_at", "is", null)
    .order("position")
    .order("id");
  const notebooks = Array.isArray(data) ? data.map(readNotebook) : null;
  if (error || notebooks === null || notebooks.includes(null)) {
    throw new Error("The notebooks could not be loaded.");
  }
  return notebooks.filter((notebook) => notebook !== null);
}

export async function getNotebook(client: NotebookClient, id: string): Promise<NotebookSummary | null> {
  const { data, error } = await client
    .from("notebooks")
    .select("id, name, pages(count)")
    .not("pages.uploaded_at", "is", null)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error("The notebook could not be loaded.");
  }
  if (data === null || data === undefined) {
    return null;
  }
  const notebook = readNotebook(data);
  if (notebook === null) {
    throw new Error("The notebook could not be read.");
  }
  return notebook;
}

export async function createNotebook(client: NotebookClient, rawName: string): Promise<CreateNotebookResult> {
  const name = rawName.trim();
  if (name === "") {
    return { status: "empty" };
  }
  try {
    const last = await client
      .from("notebooks")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    const position = last.error ? null : readNextPosition(last.data);
    if (position === null) {
      return { status: "failed" };
    }
    const inserted = await client.from("notebooks").insert({ name, position }).select("id, name").single();
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      return { status: "duplicate", name };
    }
    if (inserted.error?.code === CHECK_VIOLATION) {
      return { status: "empty" };
    }
    const notebook = inserted.error ? null : readNotebook(inserted.data);
    return notebook === null ? { status: "failed" } : { status: "created", notebook };
  } catch {
    return { status: "failed" };
  }
}

export async function renameNotebook(client: NotebookClient, id: string, rawName: string): Promise<RenameNotebookResult> {
  const name = rawName.trim();
  if (name === "") {
    return { status: "empty" };
  }
  try {
    const updated = await client.from("notebooks").update({ name }).eq("id", id).select("id, name").single();
    if (updated.error?.code === UNIQUE_VIOLATION) {
      return { status: "duplicate", name };
    }
    if (updated.error?.code === CHECK_VIOLATION) {
      return { status: "empty" };
    }
    const notebook = updated.error ? null : readNotebook(updated.data);
    return notebook === null ? { status: "failed" } : { status: "renamed", notebook };
  } catch {
    return { status: "failed" };
  }
}
