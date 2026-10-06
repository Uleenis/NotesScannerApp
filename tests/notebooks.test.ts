import {
  createNotebook,
  getNotebook,
  listNotebooks,
  type NotebookClient,
} from "@/notebooks/notebooks";

type Outcome<T> = { data: T | null; error: { code?: string } | null };
type Row = { id: string; name: string; pages: { count: number }[] };

type Script = {
  positions?: Outcome<{ position: number }[]>;
  inserted?: Outcome<{ id: string; name: string }>;
  rows?: Outcome<Row[]>;
  row?: Outcome<Row>;
  throws?: boolean;
};

type Call = { table: string; operation: string; args: unknown[] };

function fakeClient(script: Script) {
  const calls: Call[] = [];
  const record = (operation: string, ...args: unknown[]) => {
    calls.push({ table: "notebooks", operation, args });
    if (script.throws) {
      throw new TypeError("Network request failed");
    }
  };
  const settled = <T>(outcome: Outcome<T> | undefined) =>
    Promise.resolve(outcome ?? { data: null, error: { code: "unscripted" } });

  const sorted = Object.assign(settled(script.rows), {
    order: (column: string) => {
      record("order", column);
      return settled(script.rows);
    },
    limit: (count: number) => {
      record("limit", count);
      return settled(script.positions);
    },
  });
  const selection = Object.assign(settled(script.rows), {
    not: (column: string, operator: string, value: unknown) => {
      record("not", column, operator, value);
      return selection;
    },
    order: (column: string, options?: { ascending: boolean }) => {
      record("order", column, options);
      return sorted;
    },
    eq: (column: string, value: string) => {
      record("eq", column, value);
      return { maybeSingle: () => settled(script.row) };
    },
  });
  const client = {
    from: () => ({
      select: (columns: string) => {
        record("select", columns);
        return selection;
      },
      insert: (values: { name: string; position: number }) => {
        record("insert", values);
        return { select: () => ({ single: () => settled(script.inserted) }) };
      },
    }),
  } as unknown as NotebookClient;
  return { client, calls };
}

const created = (name: string): Outcome<{ id: string; name: string }> => ({
  data: { id: "new-id", name },
  error: null,
});

const noPosition: Outcome<{ position: number }[]> = { data: [], error: null };

test.each([["empty", ""], ["blank", "   "], ["tabs and line breaks", " \t\n "]])(
  "does not contact the database for a %s name",
  async (_label, name) => {
    const { client, calls } = fakeClient({});

    expect(await createNotebook(client, name)).toEqual({ status: "empty" });
    expect(calls).toEqual([]);
  },
);

test("sends the trimmed name and nothing but the name and the position", async () => {
  const { client, calls } = fakeClient({ positions: noPosition, inserted: created("Histoire") });

  const result = await createNotebook(client, "  Histoire \n");

  expect(result).toEqual({ status: "created", notebook: { id: "new-id", name: "Histoire", pageCount: 0 } });
  const insert = calls.find((call) => call.operation === "insert");
  expect(insert?.args).toEqual([{ name: "Histoire", position: 0 }]);
});

test("puts the new notebook after the last one", async () => {
  const { client, calls } = fakeClient({ positions: { data: [{ position: 4 }], error: null }, inserted: created("Sciences") });

  await createNotebook(client, "Sciences");

  expect(calls.find((call) => call.operation === "insert")?.args).toEqual([{ name: "Sciences", position: 5 }]);
  expect(calls.find((call) => call.operation === "order")?.args).toEqual(["position", { ascending: false }]);
});

test("answers duplicate, with the name, when the database refuses a second notebook of that name", async () => {
  const { client } = fakeClient({ positions: noPosition, inserted: { data: null, error: { code: "23505" } } });

  expect(await createNotebook(client, " Histoire ")).toEqual({ status: "duplicate", name: "Histoire" });
});

test("treats a name the database finds blank as empty", async () => {
  const { client } = fakeClient({ positions: noPosition, inserted: { data: null, error: { code: "23514" } } });

  expect(await createNotebook(client, "​")).toEqual({ status: "empty" });
});

test("answers failed for any other database error", async () => {
  const { client } = fakeClient({ positions: noPosition, inserted: { data: null, error: { code: "08006" } } });

  expect(await createNotebook(client, "Histoire")).toEqual({ status: "failed" });
});

test("answers failed and creates nothing when the last position cannot be read", async () => {
  const { client, calls } = fakeClient({ positions: { data: null, error: { code: "08006" } } });

  expect(await createNotebook(client, "Histoire")).toEqual({ status: "failed" });
  expect(calls.some((call) => call.operation === "insert")).toBe(false);
});

test("answers failed when the network call throws", async () => {
  const { client } = fakeClient({ throws: true });

  expect(await createNotebook(client, "Histoire")).toEqual({ status: "failed" });
});

test("lists the notebooks in position order with their number of pages", async () => {
  const { client, calls } = fakeClient({
    rows: {
      data: [
        { id: "a", name: "Histoire", pages: [{ count: 8 }] },
        { id: "b", name: "Sciences", pages: [{ count: 0 }] },
        { id: "c", name: "Journal", pages: [] },
      ],
      error: null,
    },
  });

  expect(await listNotebooks(client)).toEqual([
    { id: "a", name: "Histoire", pageCount: 8 },
    { id: "b", name: "Sciences", pageCount: 0 },
    { id: "c", name: "Journal", pageCount: 0 },
  ]);
  expect(calls.filter((call) => call.operation === "order").map((call) => call.args[0])).toEqual(["position", "id"]);
});

test("counts only the pages whose photo was uploaded, in the list and for one notebook", async () => {
  const listed = fakeClient({ rows: { data: [], error: null } });
  await listNotebooks(listed.client);
  const one = fakeClient({ row: { data: { id: "a", name: "Histoire", pages: [{ count: 1 }] }, error: null } });
  await getNotebook(one.client, "a");

  for (const { calls } of [listed, one]) {
    expect(calls.find((call) => call.operation === "not")?.args).toEqual(["pages.uploaded_at", "is", null]);
  }
});

test("lists nothing for an account without notebooks", async () => {
  const { client } = fakeClient({ rows: { data: [], error: null } });

  expect(await listNotebooks(client)).toEqual([]);
});

test("refuses to list when the database answers with an error", async () => {
  const { client } = fakeClient({ rows: { data: null, error: { code: "08006" } } });

  await expect(listNotebooks(client)).rejects.toThrow();
});

test("gets one notebook with its number of pages", async () => {
  const { client, calls } = fakeClient({ row: { data: { id: "a", name: "Histoire", pages: [{ count: 3 }] }, error: null } });

  expect(await getNotebook(client, "a")).toEqual({ id: "a", name: "Histoire", pageCount: 3 });
  expect(calls.find((call) => call.operation === "eq")?.args).toEqual(["id", "a"]);
});

test("answers null for a notebook that does not exist", async () => {
  const { client } = fakeClient({ row: { data: null, error: null } });

  expect(await getNotebook(client, "missing")).toBeNull();
});

test("refuses to get a notebook when the database answers with an error", async () => {
  const { client } = fakeClient({ row: { data: null, error: { code: "08006" } } });

  await expect(getNotebook(client, "a")).rejects.toThrow();
});
