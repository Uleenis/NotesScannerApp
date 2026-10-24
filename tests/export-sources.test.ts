import { readExportSources } from "@/export/sources";

type Query = { table: string; filters: [string, unknown][]; limit: number | null; columns: string };

type Answer = { data: unknown; error: unknown };

function fakeClient(answer: (query: Query) => Answer) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, filters: [], limit: null, columns: "" };
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        in(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        limit(count: number) {
          query.limit = count;
          queries.push(query);
          return Promise.resolve(answer(query));
        },
        then(resolve: (value: Answer) => unknown) {
          queries.push(query);
          return Promise.resolve(answer(query)).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as never, queries };
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `page-${index}`);

describe("readExportSources", () => {
  test("reads the second reading of the pages by groups and whether each page was edited", async () => {
    const { client, queries } = fakeClient((query) => {
      if (query.table === "readings") {
        const wanted = query.filters.find(([column]) => column === "page_id")?.[1] as string[];
        return { data: wanted.filter((id) => id !== "page-1").map((id) => ({ page_id: id, raw_text: `B2 ${id}` })), error: null };
      }
      if (query.table === "page_gaps") {
        return { data: query.filters.some(([, value]) => value === "page-2") ? [{ page_id: "page-2" }] : [], error: null };
      }
      return { data: query.filters.some(([, value]) => value === "page-0") ? [{ page_id: "page-0" }] : [], error: null };
    });

    const sources = await readExportSources(client, ids(3));

    expect(sources.get("page-0")).toEqual({ second: "B2 page-0", edited: true });
    expect(sources.get("page-1")).toEqual({ second: null, edited: false });
    expect(sources.get("page-2")).toEqual({ second: "B2 page-2", edited: true });
    const readings = queries.filter((query) => query.table === "readings");
    expect(readings).toHaveLength(1);
    expect(readings[0].filters).toContainEqual(["label", "B2"]);
    expect(queries.filter((query) => query.table === "page_gaps").every((query) => query.limit === 1)).toBe(true);
    expect(queries.filter((query) => query.table === "corrections").every((query) => query.filters.some(([column, value]) => column === "corrected_text" && value === ""))).toBe(true);
  });

  test("reads the readings in groups of at most 50 pages", async () => {
    const { client, queries } = fakeClient(() => ({ data: [], error: null }));
    await readExportSources(client, ids(120));
    const readings = queries.filter((query) => query.table === "readings");
    expect(readings.map((query) => (query.filters.find(([column]) => column === "page_id")?.[1] as string[]).length)).toEqual([50, 50, 20]);
  });

  test("makes no request for no page", async () => {
    const { client, queries } = fakeClient(() => ({ data: [], error: null }));
    expect((await readExportSources(client, [])).size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  test.each(["readings", "page_gaps", "corrections"])("fails when the read of %s fails", async (table) => {
    const { client } = fakeClient((query) => (query.table === table ? { data: null, error: { message: "denied" } } : { data: [], error: null }));
    await expect(readExportSources(client, ids(2))).rejects.toThrow();
  });

  test("fails on a row it cannot read", async () => {
    const { client } = fakeClient((query) => (query.table === "readings" ? { data: [{ page_id: "page-0", raw_text: 7 }], error: null } : { data: [], error: null }));
    await expect(readExportSources(client, ids(1))).rejects.toThrow();
  });
});
