import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { countPages, getPage, listPages, newestFirst, numberPages, photoUrl, startReading, type PageRecord, type PagesClient } from "@/pages/pages";

type Outcome = { data: unknown; error: unknown; count?: number | null };
type Call = [string, unknown[]];

function query(outcome: Outcome) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "not", "order", "eq"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => {
    calls.push(["maybeSingle", []]);
    return outcome;
  };
  chain.then = (resolve: (value: Outcome) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcome).then(resolve, reject);
  return { chain, calls };
}

function database(...outcomes: Outcome[]) {
  const queries = outcomes.map(query);
  let next = 0;
  const from = jest.fn((_table: string) => queries[Math.min(next++, queries.length - 1)].chain);
  return { client: { from } as unknown as PagesClient, from, queries };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    notebook_id: "notebook-1",
    status: "read",
    queue_reason: null,
    captured_at: "2026-09-26T12:32:00+00:00",
    uploaded_at: "2026-09-26T12:32:05+00:00",
    attempted_at: null,
    page_texts: [{ text: "Titre\nCorps" }],
    ...overrides,
  };
}

function record(overrides: Partial<PageRecord>): PageRecord {
  return {
    id: "page-1",
    notebookId: "notebook-1",
    status: "read",
    queueReason: null,
    capturedAt: "2026-09-26T12:32:00+00:00",
    uploadedAt: "2026-09-26T12:32:05+00:00",
    attemptedAt: null,
    text: null,
    ...overrides,
  };
}

describe("numberPages", () => {
  test("numbers the pages of a notebook from the oldest to the newest", () => {
    const pages = [
      record({ id: "c", capturedAt: "2026-09-28T10:00:00+00:00" }),
      record({ id: "a", capturedAt: "2026-09-26T10:00:00+00:00" }),
      record({ id: "b", capturedAt: "2026-09-27T10:00:00+00:00" }),
    ];
    expect(numberPages(pages).map(({ id, number }) => [id, number])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  test("numbers every notebook on its own", () => {
    const pages = [
      record({ id: "h1", notebookId: "histoire", capturedAt: "2026-09-26T10:00:00+00:00" }),
      record({ id: "s1", notebookId: "sciences", capturedAt: "2026-09-27T10:00:00+00:00" }),
      record({ id: "h2", notebookId: "histoire", capturedAt: "2026-09-28T10:00:00+00:00" }),
    ];
    expect(Object.fromEntries(numberPages(pages).map(({ id, number }) => [id, number]))).toEqual({ h1: 1, s1: 1, h2: 2 });
  });

  test("breaks a tie of capture moments by the page id", () => {
    const pages = [record({ id: "b" }), record({ id: "a" })];
    expect(numberPages(pages).map(({ id }) => id)).toEqual(["a", "b"]);
  });

  test("compares moments, not the way they are written", () => {
    const pages = [
      record({ id: "later", capturedAt: "2026-09-26T10:30:00.123456+00:00" }),
      record({ id: "earlier", capturedAt: "2026-09-26T11:00:00+02:00" }),
    ];
    expect(numberPages(pages).map(({ id }) => id)).toEqual(["earlier", "later"]);
  });
});

describe("newestFirst", () => {
  test("orders pages of any notebook from the latest capture to the earliest, whatever the order they come in", () => {
    const pages = numberPages([
      record({ id: "b", notebookId: "n2", capturedAt: "2026-09-27T10:00:00+00:00" }),
      record({ id: "c", capturedAt: "2026-09-28T10:00:00+00:00" }),
      record({ id: "a", capturedAt: "2026-09-26T10:00:00+00:00" }),
    ]);
    expect(newestFirst([pages[1], pages[2], pages[0]]).map(({ id }) => id)).toEqual(["c", "b", "a"]);
  });

  test("does not change the list it is given", () => {
    const pages = numberPages([record({ id: "a", capturedAt: "2026-09-26T10:00:00+00:00" }), record({ id: "b", capturedAt: "2026-09-27T10:00:00+00:00" })]);
    const copy = [...pages];
    newestFirst(pages);
    expect(pages).toEqual(copy);
  });
});

describe("listPages", () => {
  test("asks for the visible pages of the user, with their text, from the oldest", async () => {
    const fake = database({ data: [row()], error: null });
    await listPages(fake.client);

    expect(fake.from).toHaveBeenCalledWith("pages");
    const calls = fake.queries[0].calls;
    expect(calls[0][0]).toBe("select");
    expect(calls[0][1][0]).toEqual(expect.stringContaining("page_texts(text)"));
    expect(calls[0][1][0]).toEqual(expect.stringContaining("uploaded_at"));
    expect(calls[0][1][0]).toEqual(expect.stringContaining("attempted_at"));
    expect(calls).toContainEqual(["not", ["uploaded_at", "is", null]]);
    expect(calls).toContainEqual(["order", ["captured_at", { ascending: true }]]);
  });

  test("reads a row into a page with its number", async () => {
    const fake = database({
      data: [row({ status: "queued", queue_reason: "read_error", attempted_at: "2026-09-26T12:40:00+00:00", page_texts: [] })],
      error: null,
    });
    expect(await listPages(fake.client)).toEqual([
      {
        id: "page-1",
        notebookId: "notebook-1",
        status: "queued",
        queueReason: "read_error",
        capturedAt: "2026-09-26T12:32:00+00:00",
        uploadedAt: "2026-09-26T12:32:05+00:00",
        attemptedAt: "2026-09-26T12:40:00+00:00",
        text: null,
        number: 1,
      },
    ]);
  });

  test("reads the text whether the database gives one text or a list of texts", async () => {
    const asList = database({ data: [row({ page_texts: [{ text: "Un" }] })], error: null });
    const asObject = database({ data: [row({ page_texts: { text: "Deux" } })], error: null });
    const asNothing = database({ data: [row({ page_texts: null })], error: null });
    expect((await listPages(asList.client))[0].text).toBe("Un");
    expect((await listPages(asObject.client))[0].text).toBe("Deux");
    expect((await listPages(asNothing.client))[0].text).toBeNull();
  });

  test("keeps the text exactly as the database gives it", async () => {
    const text = "  Titre  \r\n\r\nLigne -> suite,\nfin\n";
    const fake = database({ data: [row({ page_texts: [{ text }] })], error: null });
    expect((await listPages(fake.client))[0].text).toBe(text);
  });

  test("is empty when the user has no page", async () => {
    expect(await listPages(database({ data: [], error: null }).client)).toEqual([]);
  });

  test("fails when the database fails", async () => {
    await expect(listPages(database({ data: null, error: { message: "boom" } }).client)).rejects.toThrow();
  });

  test("fails on a row that cannot be read instead of showing a wrong page", async () => {
    await expect(listPages(database({ data: [row({ status: "sleeping" })], error: null }).client)).rejects.toThrow();
    await expect(listPages(database({ data: [row({ id: 7 })], error: null }).client)).rejects.toThrow();
    await expect(listPages(database({ data: [row({ uploaded_at: null })], error: null }).client)).rejects.toThrow();
  });
});

describe("getPage", () => {
  const siblings = (ids: [string, string][]) => ({ data: ids.map(([id, captured_at]) => ({ id, captured_at })), error: null });

  test("reads one visible page by its id and numbers it among the visible pages of its notebook", async () => {
    const fake = database(
      { data: row({ id: "page-3", captured_at: "2026-09-28T10:00:00+00:00" }), error: null },
      siblings([
        ["page-1", "2026-09-26T10:00:00+00:00"],
        ["page-3", "2026-09-28T10:00:00+00:00"],
        ["page-2", "2026-09-27T10:00:00+00:00"],
      ]),
    );
    const page = await getPage(fake.client, "page-3");

    expect(page?.id).toBe("page-3");
    expect(page?.number).toBe(3);
    expect(fake.queries[0].calls).toContainEqual(["eq", ["id", "page-3"]]);
    expect(fake.queries[0].calls).toContainEqual(["not", ["uploaded_at", "is", null]]);
    expect(fake.queries[1].calls).toContainEqual(["eq", ["notebook_id", "notebook-1"]]);
    expect(fake.queries[1].calls).toContainEqual(["not", ["uploaded_at", "is", null]]);
  });

  test("does not count a page hidden by the rule of the visible pages", async () => {
    const fake = database(
      { data: row({ id: "page-2", captured_at: "2026-09-27T10:00:00+00:00" }), error: null },
      siblings([
        ["page-1", "2026-09-26T10:00:00+00:00"],
        ["page-2", "2026-09-27T10:00:00+00:00"],
      ]),
    );
    expect((await getPage(fake.client, "page-2"))?.number).toBe(2);
  });

  test("is null for a page that does not exist or is not visible", async () => {
    const fake = database({ data: null, error: null });
    expect(await getPage(fake.client, "page-9")).toBeNull();
    expect(fake.from).toHaveBeenCalledTimes(1);
  });

  test("fails when either request fails", async () => {
    await expect(getPage(database({ data: null, error: { message: "boom" } }).client, "p")).rejects.toThrow();
    await expect(getPage(database({ data: row(), error: null }, { data: null, error: { message: "boom" } }).client, "page-1")).rejects.toThrow();
  });
});

describe("photoUrl", () => {
  test("asks for a signed address of the original photo under the folder of the user, valid for an hour", async () => {
    const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: "https://storage.test/signed" }, error: null }));
    const from = jest.fn(() => ({ createSignedUrl }));
    const client = { storage: { from } } as unknown as PagesClient;

    expect(await photoUrl(client, "user-1", "page-1")).toBe("https://storage.test/signed");
    expect(from).toHaveBeenCalledWith("photos");
    expect(createSignedUrl).toHaveBeenCalledWith("user-1/page-1/original.jpg", 3600);
  });

  test("fails when no address is given", async () => {
    const failing = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "denied" } }) }) } } as unknown as PagesClient;
    const empty = { storage: { from: () => ({ createSignedUrl: async () => ({ data: {}, error: null }) }) } } as unknown as PagesClient;
    await expect(photoUrl(failing, "u", "p")).rejects.toThrow();
    await expect(photoUrl(empty, "u", "p")).rejects.toThrow();
  });
});

describe("startReading", () => {
  const functionsClient = (outcome: Outcome | (() => Promise<Outcome>)) => {
    const invoke = jest.fn(typeof outcome === "function" ? outcome : async () => outcome);
    return { client: { functions: { invoke } } as unknown as PagesClient, invoke };
  };
  const refusal = (status: number, error: string) => new FunctionsHttpError(new Response(JSON.stringify({ error }), { status }));

  test("calls read-page with the page id alone", async () => {
    const fake = functionsClient({ data: { status: "read" }, error: null });
    await startReading(fake.client, "page-1");
    expect(fake.invoke).toHaveBeenCalledWith("read-page", { body: { page_id: "page-1" } });
  });

  test.each([
    ["read", { status: "read" }],
    ["queued", { status: "queued" }],
    ["failed", { status: "failed" }],
  ])("translates a successful answer %s", async (status, expected) => {
    const fake = functionsClient({ data: { status, queue_reason: status === "queued" ? "read_error" : undefined }, error: null });
    expect(await startReading(fake.client, "p")).toEqual(expected);
  });

  test.each([
    [403, "monthly_limit", { status: "limit", reason: "monthly_limit" }],
    [403, "anonymous_limit", { status: "limit", reason: "anonymous_limit" }],
    [403, "anonymous_daily_cap", { status: "limit", reason: "anonymous_daily_cap" }],
    [409, "page_processing", { status: "busy" }],
    [409, "page_already_read", { status: "busy" }],
    [409, "page_failed", { status: "error" }],
    [422, "photo_missing", { status: "photo" }],
    [422, "photo_not_jpeg", { status: "photo" }],
    [422, "photo_too_large", { status: "photo" }],
    [429, "relaunch_too_soon", { status: "tooSoon" }],
    [404, "page_not_found", { status: "missing" }],
    [401, "unauthenticated", { status: "error" }],
    [400, "invalid_request", { status: "error" }],
    [500, "something_new", { status: "error" }],
  ])("translates the refusal %i %s by its code", async (status, code, expected) => {
    const fake = functionsClient({ data: null, error: refusal(status, code) });
    expect(await startReading(fake.client, "p")).toEqual(expected);
  });

  test("never trusts a sentence of the server, only its codes", async () => {
    const fake = functionsClient({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: "Your page is nice", message: "monthly_limit" }), { status: 403 })) });
    expect(await startReading(fake.client, "p")).toEqual({ status: "error" });
  });

  test("a refusal whose body cannot be read is an error", async () => {
    const fake = functionsClient({ data: null, error: new FunctionsHttpError(new Response("<html>", { status: 502 })) });
    expect(await startReading(fake.client, "p")).toEqual({ status: "error" });
  });

  test("an answer that is not one of the known statuses is an error", async () => {
    expect(await startReading(functionsClient({ data: { status: "processing" }, error: null }).client, "p")).toEqual({ status: "error" });
    expect(await startReading(functionsClient({ data: null, error: null }).client, "p")).toEqual({ status: "error" });
  });

  test("a request that never reaches the server is a network failure", async () => {
    const fetchError = functionsClient({ data: null, error: new FunctionsFetchError(new TypeError("Network request failed")) });
    const thrown = functionsClient(() => Promise.reject(new TypeError("Network request failed")));
    expect(await startReading(fetchError.client, "p")).toEqual({ status: "network" });
    expect(await startReading(thrown.client, "p")).toEqual({ status: "network" });
  });

  test("any other failure is an error and never throws", async () => {
    const thrown = functionsClient(() => Promise.reject(new Error("boom")));
    expect(await startReading(thrown.client, "p")).toEqual({ status: "error" });
  });
});

describe("counting the pages of the account", () => {
  test("counts the pages whose photo arrived, and nothing else", async () => {
    const { client, from, queries } = database({ data: null, error: null, count: 3 });

    expect(await countPages(client)).toBe(3);

    expect(from).toHaveBeenCalledWith("pages");
    expect(queries[0].calls).toEqual([
      ["select", ["id", { count: "exact", head: true }]],
      ["not", ["uploaded_at", "is", null]],
    ]);
  });

  test("counts zero pages", async () => {
    const { client } = database({ data: null, error: null, count: 0 });

    expect(await countPages(client)).toBe(0);
  });

  test("fails rather than saying zero when the database does not answer", async () => {
    const { client } = database({ data: null, error: new Error("offline"), count: null });

    await expect(countPages(client)).rejects.toThrow("The pages could not be counted.");
  });

  test("fails rather than saying zero when there is no count in the answer", async () => {
    const { client } = database({ data: null, error: null, count: null });

    await expect(countPages(client)).rejects.toThrow("The pages could not be counted.");
  });
});
