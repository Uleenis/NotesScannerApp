export type Row = Record<string, unknown>;

export type Query = { table: string; columns: string; filters: [string, unknown][]; order: string[]; range: [number, number] | null };

export type FakeArchive = {
  client: never;
  queries: Query[];
  listed: string[];
};

type Options = { leaky?: boolean; failTable?: string; folders?: Record<string, { name: string; metadata: { size: number } | null }[]> };

function compare(a: unknown, b: unknown): number {
  if (a === b) {
    return 0;
  }
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

export function fakeArchiveClient(tables: Record<string, Row[]>, options: Options = {}): FakeArchive {
  const queries: Query[] = [];
  const listed: string[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, columns: "", filters: [], order: [], range: null };
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
        order(column: string) {
          query.order.push(column);
          return builder;
        },
        range(from: number, to: number) {
          query.range = [from, to];
          queries.push(query);
          return Promise.resolve(answer(query));
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          list: async (path: string) => {
            listed.push(`${bucket}/${path}`);
            const found = options.folders?.[path];
            return found === undefined ? { data: [], error: null } : { data: found, error: null };
          },
        };
      },
    },
  };

  function answer(query: Query): { data: unknown; error: unknown } {
    if (options.failTable === query.table) {
      return { data: null, error: { message: "failed" } };
    }
    let rows = tables[query.table] ?? [];
    if (!options.leaky) {
      for (const [column, value] of query.filters) {
        rows = rows.filter((row) => (Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
      }
    }
    const sorted = [...rows].sort((a, b) => {
      for (const column of query.order) {
        const result = compare(a[column], b[column]);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    });
    const [from, to] = query.range ?? [0, sorted.length];
    const wanted = query.columns.split(",").map((column) => column.trim());
    return {
      data: sorted.slice(from, to + 1).map((row) => Object.fromEntries(wanted.filter((column) => column in row).map((column) => [column, row[column]]))),
      error: null,
    };
  }

  return { client: client as never, queries, listed };
}
