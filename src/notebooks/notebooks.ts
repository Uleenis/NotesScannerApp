export type NotebookSummary = { id: string; name: string; pageCount: number };

export type CreateNotebookResult =
  | { status: "created"; notebook: NotebookSummary }
  | { status: "empty" }
  | { status: "duplicate"; name: string }
  | { status: "failed" };

type NotebookRow = { id: string; name: string; pages: { count: number }[] };

type Reply<T> = PromiseLike<{ data: T | null; error: { code?: string } | null }>;

export type NotebookSelection = Reply<NotebookRow[]> & {
  order: (column: string, options?: { ascending: boolean }) => NotebookSelection;
  limit: (count: number) => Reply<{ position: number }[]>;
  eq: (column: string, value: string) => { maybeSingle: () => Reply<NotebookRow> };
};

export type NotebookClient = {
  from: (table: "notebooks") => {
    select: (columns: string) => NotebookSelection;
    insert: (values: { name: string; position: number }) => {
      select: (columns: string) => { single: () => Reply<{ id: string; name: string }> };
    };
  };
};

const WITH_PAGE_COUNT = "id, name, pages(count)";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function summarize(row: NotebookRow): NotebookSummary {
  return { id: row.id, name: row.name, pageCount: row.pages[0]?.count ?? 0 };
}

export async function listNotebooks(client: NotebookClient): Promise<NotebookSummary[]> {
  const { data, error } = await client
    .from("notebooks")
    .select("id, name, position, pages(count)")
    .order("position")
    .order("id");
  if (error || !data) {
    throw new Error("The notebooks could not be loaded.");
  }
  return data.map(summarize);
}

export async function getNotebook(client: NotebookClient, id: string): Promise<NotebookSummary | null> {
  const { data, error } = await client.from("notebooks").select(WITH_PAGE_COUNT).eq("id", id).maybeSingle();
  if (error) {
    throw new Error("The notebook could not be loaded.");
  }
  return data ? summarize(data) : null;
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
    if (last.error) {
      return { status: "failed" };
    }
    const position = last.data && last.data.length > 0 ? last.data[0].position + 1 : 0;
    const inserted = await client.from("notebooks").insert({ name, position }).select("id, name").single();
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      return { status: "duplicate", name };
    }
    if (inserted.error?.code === CHECK_VIOLATION) {
      return { status: "empty" };
    }
    if (inserted.error || !inserted.data) {
      return { status: "failed" };
    }
    return { status: "created", notebook: { id: inserted.data.id, name: inserted.data.name, pageCount: 0 } };
  } catch {
    return { status: "failed" };
  }
}
