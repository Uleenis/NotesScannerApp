import { readAnchor, searchPages, type SearchClient } from "@/search/search";

type Outcome = { data: unknown; error: unknown };

function client(outcomes: { search?: Outcome; suggest?: Outcome; token?: Outcome }) {
  const calls: { name: string; args: unknown }[] = [];
  const rpc = jest.fn(async (name: string, args: unknown) => {
    calls.push({ name, args });
    return (name === "search_pages" ? outcomes.search : outcomes.suggest) ?? { data: [], error: null };
  });
  const filters: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  chain.select = (columns: string) => {
    filters.push(["select", columns]);
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.maybeSingle = async () => outcomes.token ?? { data: null, error: null };
  const from = jest.fn((table: string) => {
    filters.push(["from", table]);
    return chain;
  });
  return { client: { rpc, from } as unknown as SearchClient, calls, filters };
}

const row = {
  page_id: "page-1",
  notebook_id: "notebook-1",
  rank: 1,
  token_index: 7,
  excerpt: "Fernand de Magellan",
  match_start: 11,
  match_end: 19,
  also_read: null,
};

describe("searchPages", () => {
  test("sends the trimmed query and the notebook to both functions and reads their rows", async () => {
    const { client: supabase, calls } = client({
      search: { data: [row, { ...row, page_id: "page-2", rank: 2, token_index: null, match_start: null, match_end: null, also_read: "Magelan" }], error: null },
      suggest: { data: [{ word: "magelan", suggestion: "Magellan" }], error: null },
    });

    const outcome = await searchPages(supabase, "  Magelan ", "notebook-1");

    expect(calls).toEqual([
      { name: "search_pages", args: { p_query: "Magelan", p_notebook_id: "notebook-1" } },
      { name: "suggest_words", args: { p_query: "Magelan", p_notebook_id: "notebook-1" } },
    ]);
    expect(outcome).toEqual({
      status: "found",
      hits: [
        { pageId: "page-1", notebookId: "notebook-1", rank: 1, tokenIndex: 7, excerpt: "Fernand de Magellan", matchStart: 11, matchEnd: 19, alsoRead: null },
        { pageId: "page-2", notebookId: "notebook-1", rank: 2, tokenIndex: null, excerpt: "Fernand de Magellan", matchStart: null, matchEnd: null, alsoRead: "Magelan" },
      ],
      suggestions: [{ word: "magelan", suggestion: "Magellan" }],
    });
  });

  test("searches every notebook with a null filter", async () => {
    const { client: supabase, calls } = client({});
    await searchPages(supabase, "Magellan", null);
    expect(calls[0].args).toEqual({ p_query: "Magellan", p_notebook_id: null });
  });

  test("calls nothing for a query with no character", async () => {
    const { client: supabase, calls } = client({});
    expect(await searchPages(supabase, "   ", null)).toEqual({ status: "found", hits: [], suggestions: [] });
    expect(calls).toEqual([]);
  });

  test("tells the two refusals of the bounds apart", async () => {
    const long = client({ search: { data: null, error: { code: "22023", message: "query_too_long" } } });
    expect(await searchPages(long.client, "x", null)).toEqual({ status: "tooLong" });
    const many = client({ search: { data: null, error: { code: "22023", message: "query_too_many_words" } } });
    expect(await searchPages(many.client, "x", null)).toEqual({ status: "tooManyWords" });
  });

  test("fails on any other error or any row it cannot read", async () => {
    expect(await searchPages(client({ search: { data: null, error: { code: "XX000", message: "boom" } } }).client, "x", null)).toEqual({ status: "error" });
    expect(await searchPages(client({ search: { data: [{ ...row, rank: 3 }], error: null } }).client, "x", null)).toEqual({ status: "error" });
    expect(await searchPages(client({ search: { data: [{ ...row, page_id: 4 }], error: null } }).client, "x", null)).toEqual({ status: "error" });
    expect(await searchPages(client({ search: { data: [{ ...row, match_start: 3, match_end: null }], error: null } }).client, "x", null)).toEqual({ status: "error" });
    expect(await searchPages(client({ search: { data: {}, error: null } }).client, "x", null)).toEqual({ status: "error" });
  });

  test("still finds pages when the suggestion cannot be read", async () => {
    const { client: supabase } = client({
      search: { data: [row], error: null },
      suggest: { data: null, error: { code: "XX000", message: "boom" } },
    });
    const outcome = await searchPages(supabase, "Magellan", null);
    expect(outcome.status).toBe("found");
    expect(outcome.status === "found" ? outcome.suggestions : null).toEqual([]);
  });

  test("ignores a suggestion row it cannot read", async () => {
    const { client: supabase } = client({
      search: { data: [], error: null },
      suggest: { data: [{ word: "magelan", suggestion: "Magellan" }, { word: 3, suggestion: "x" }, { word: "a", suggestion: "" }], error: null },
    });
    const outcome = await searchPages(supabase, "Magelan", null);
    expect(outcome.status === "found" ? outcome.suggestions : null).toEqual([{ word: "magelan", suggestion: "Magellan" }]);
  });
});

describe("readAnchor", () => {
  test("reads the box of one position of one page", async () => {
    const { client: supabase, filters } = client({ token: { data: { anchor_kind: "word", anchor: [10, 20, 110, 60] }, error: null } });
    expect(await readAnchor(supabase, "page-1", 7)).toEqual({ kind: "word", box: [10, 20, 110, 60] });
    expect(filters).toEqual([
      ["from", "page_tokens"],
      ["select", "anchor_kind, anchor"],
      ["page_id", "page-1"],
      ["token_index", 7],
    ]);
  });

  test("gives a line box as a line", async () => {
    const { client: supabase } = client({ token: { data: { anchor_kind: "line", anchor: [0, 20, 500, 60] }, error: null } });
    expect(await readAnchor(supabase, "page-1", 7)).toEqual({ kind: "line", box: [0, 20, 500, 60] });
  });

  test("gives nothing for a position without a box or a row that is not there", async () => {
    expect(await readAnchor(client({ token: { data: { anchor_kind: null, anchor: null }, error: null } }).client, "page-1", 7)).toBeNull();
    expect(await readAnchor(client({ token: { data: null, error: null } }).client, "page-1", 7)).toBeNull();
  });

  test("gives nothing for a box it cannot read and throws on an error", async () => {
    expect(await readAnchor(client({ token: { data: { anchor_kind: "word", anchor: [1, 2, 3] }, error: null } }).client, "page-1", 7)).toBeNull();
    expect(await readAnchor(client({ token: { data: { anchor_kind: "word", anchor: [1, 2, "3", 4] }, error: null } }).client, "page-1", 7)).toBeNull();
    expect(await readAnchor(client({ token: { data: { anchor_kind: "other", anchor: [1, 2, 3, 4] }, error: null } }).client, "page-1", 7)).toBeNull();
    await expect(readAnchor(client({ token: { data: null, error: { message: "boom" } } }).client, "page-1", 7)).rejects.toThrow();
  });
});
