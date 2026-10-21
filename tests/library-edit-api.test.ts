import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { insertPage, type CaptureClient } from "@/capture/api";
import { createChapter, listChapters, renameChapter, type ChapterClient } from "@/notebooks/chapters";
import { renameNotebook, type NotebookClient } from "@/notebooks/notebooks";
import { deleteChapter, deleteNotebook } from "@/notebooks/removal";
import { deletePage, listPages, movePage, type PagesClient } from "@/pages/pages";

type Outcome = { data: unknown; error: unknown };
type Call = [string, unknown[]];

function query(outcome: Outcome) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "not", "order", "eq", "limit", "insert", "update"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.single = async () => {
    calls.push(["single", []]);
    return outcome;
  };
  chain.then = (resolve: (value: Outcome) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcome).then(resolve, reject);
  return { chain, calls };
}

function database(...outcomes: Outcome[]) {
  const queries = outcomes.map(query);
  let next = 0;
  const from = jest.fn((_table: string) => queries[Math.min(next++, queries.length - 1)].chain);
  return { client: { from } as unknown as NotebookClient & ChapterClient & CaptureClient & PagesClient, from, queries };
}

function functionsClient(outcome: Outcome | (() => Promise<Outcome>)) {
  const invoke = jest.fn(typeof outcome === "function" ? outcome : async () => outcome);
  return { client: { functions: { invoke } } as unknown as PagesClient, invoke };
}

const refusal = (status: number, error: string) => new FunctionsHttpError(new Response(JSON.stringify({ error }), { status }));

describe("renameNotebook", () => {
  test("trims the name and updates the name alone of the notebook", async () => {
    const db = database({ data: { id: "n1", name: "Chimie" }, error: null });
    expect(await renameNotebook(db.client, "n1", "  Chimie ")).toEqual({ status: "renamed", notebook: { id: "n1", name: "Chimie", pageCount: 0 } });
    expect(db.from).toHaveBeenCalledWith("notebooks");
    expect(db.queries[0].calls).toEqual([["update", [{ name: "Chimie" }]], ["eq", ["id", "n1"]], ["select", ["id, name"]], ["single", []]]);
  });

  test("a blank name is refused without a call", async () => {
    const db = database({ data: null, error: null });
    expect(await renameNotebook(db.client, "n1", "   ")).toEqual({ status: "empty" });
    expect(db.from).not.toHaveBeenCalled();
  });

  test("a name already taken is a duplicate, a check violation is an empty name", async () => {
    expect(await renameNotebook(database({ data: null, error: { code: "23505" } }).client, "n1", "Histoire")).toEqual({ status: "duplicate", name: "Histoire" });
    expect(await renameNotebook(database({ data: null, error: { code: "23514" } }).client, "n1", "x")).toEqual({ status: "empty" });
  });

  test("any other error, a missing row or a throw is a failure", async () => {
    expect(await renameNotebook(database({ data: null, error: { code: "PGRST116" } }).client, "n1", "x")).toEqual({ status: "failed" });
    expect(await renameNotebook(database({ data: { nope: 1 }, error: null }).client, "n1", "x")).toEqual({ status: "failed" });
    const throwing = { from: () => { throw new TypeError("Network request failed"); } } as unknown as NotebookClient;
    expect(await renameNotebook(throwing, "n1", "x")).toEqual({ status: "failed" });
  });
});

describe("chapters", () => {
  test("lists every chapter with the count of its uploaded pages, by position", async () => {
    const db = database({
      data: [
        { id: "c1", notebook_id: "n1", name: "Intro", pages: [{ count: 3 }] },
        { id: "c2", notebook_id: "n1", name: "Suite", pages: [] },
      ],
      error: null,
    });
    expect(await listChapters(db.client)).toEqual([
      { id: "c1", notebookId: "n1", name: "Intro", pageCount: 3 },
      { id: "c2", notebookId: "n1", name: "Suite", pageCount: 0 },
    ]);
    expect(db.from).toHaveBeenCalledWith("chapters");
    expect(db.queries[0].calls).toEqual([
      ["select", ["id, notebook_id, name, position, pages(count)"]],
      ["not", ["pages.uploaded_at", "is", null]],
      ["order", ["notebook_id"]],
      ["order", ["position"]],
      ["order", ["id"]],
    ]);
  });

  test("a chapter that cannot be read, or an error, fails the whole list", async () => {
    await expect(listChapters(database({ data: [{ id: "c1" }], error: null }).client)).rejects.toThrow();
    await expect(listChapters(database({ data: null, error: { code: "x" } }).client)).rejects.toThrow();
  });

  test("creates a chapter after the last one of its notebook, with its trimmed name", async () => {
    const db = database({ data: [{ position: 2 }], error: null }, { data: { id: "c9", notebook_id: "n1", name: "Intro" }, error: null });
    expect(await createChapter(db.client, "n1", " Intro ")).toEqual({ status: "created", chapter: { id: "c9", notebookId: "n1", name: "Intro", pageCount: 0 } });
    expect(db.queries[0].calls).toEqual([
      ["select", ["position"]],
      ["eq", ["notebook_id", "n1"]],
      ["order", ["position", { ascending: false }]],
      ["limit", [1]],
    ]);
    expect(db.queries[1].calls[0]).toEqual(["insert", [{ notebook_id: "n1", name: "Intro", position: 3 }]]);
  });

  test("the first chapter of a notebook has position 0", async () => {
    const db = database({ data: [], error: null }, { data: { id: "c9", notebook_id: "n1", name: "Intro" }, error: null });
    await createChapter(db.client, "n1", "Intro");
    expect(db.queries[1].calls[0]).toEqual(["insert", [{ notebook_id: "n1", name: "Intro", position: 0 }]]);
  });

  test("creating refuses a blank name, a taken name and a failure", async () => {
    expect(await createChapter(database().client, "n1", " ")).toEqual({ status: "empty" });
    const taken = database({ data: [], error: null }, { data: null, error: { code: "23505" } });
    expect(await createChapter(taken.client, "n1", "Intro")).toEqual({ status: "duplicate", name: "Intro" });
    const blank = database({ data: [], error: null }, { data: null, error: { code: "23514" } });
    expect(await createChapter(blank.client, "n1", "Intro")).toEqual({ status: "empty" });
    expect(await createChapter(database({ data: null, error: { code: "x" } }).client, "n1", "Intro")).toEqual({ status: "failed" });
    expect(await createChapter(database({ data: [], error: null }, { data: null, error: { code: "x" } }).client, "n1", "Intro")).toEqual({ status: "failed" });
  });

  test("renames a chapter by its id with the trimmed name alone", async () => {
    const db = database({ data: { id: "c1", notebook_id: "n1", name: "Fin" }, error: null });
    expect(await renameChapter(db.client, "c1", " Fin ")).toEqual({ status: "renamed", chapter: { id: "c1", notebookId: "n1", name: "Fin", pageCount: 0 } });
    expect(db.queries[0].calls).toEqual([["update", [{ name: "Fin" }]], ["eq", ["id", "c1"]], ["select", ["id, notebook_id, name"]], ["single", []]]);
  });

  test("renaming refuses a blank name, a taken name and a failure", async () => {
    expect(await renameChapter(database().client, "c1", "")).toEqual({ status: "empty" });
    expect(await renameChapter(database({ data: null, error: { code: "23505" } }).client, "c1", "Fin")).toEqual({ status: "duplicate", name: "Fin" });
    expect(await renameChapter(database({ data: null, error: { code: "23514" } }).client, "c1", "Fin")).toEqual({ status: "empty" });
    expect(await renameChapter(database({ data: null, error: { code: "x" } }).client, "c1", "Fin")).toEqual({ status: "failed" });
  });
});

describe("deleting through the server", () => {
  const cases = [
    { name: "delete-notebook", call: (client: PagesClient) => deleteNotebook(client, "id-1"), body: { notebook_id: "id-1" } },
    { name: "delete-chapter", call: (client: PagesClient) => deleteChapter(client, "id-1"), body: { chapter_id: "id-1" } },
    { name: "delete-page", call: (client: PagesClient) => deletePage(client, "id-1"), body: { page_id: "id-1" } },
  ];

  test.each(cases)("$name sends its id alone and reads {deleted: true}", async ({ name, call, body }) => {
    const fake = functionsClient({ data: { deleted: true }, error: null });
    expect(await call(fake.client)).toEqual({ status: "deleted" });
    expect(fake.invoke).toHaveBeenCalledWith(name, { body });
  });

  test.each(cases)("$name tells a page being read, a thing already gone, the network and the rest apart", async ({ call }) => {
    expect(await call(functionsClient({ data: null, error: refusal(409, "page_processing") }).client)).toEqual({ status: "busy" });
    for (const code of ["page_not_found", "notebook_not_found", "chapter_not_found"]) {
      expect(await call(functionsClient({ data: null, error: refusal(404, code) }).client)).toEqual({ status: "missing" });
    }
    expect(await call(functionsClient({ data: null, error: refusal(400, "invalid_request") }).client)).toEqual({ status: "error" });
    expect(await call(functionsClient({ data: null, error: refusal(401, "unauthorized") }).client)).toEqual({ status: "error" });
    expect(await call(functionsClient({ data: null, error: new FunctionsFetchError(new Error("offline")) }).client)).toEqual({ status: "network" });
    expect(await call(functionsClient(async () => Promise.reject(new TypeError("Network request failed"))).client)).toEqual({ status: "network" });
    expect(await call(functionsClient(async () => Promise.reject(new Error("boom"))).client)).toEqual({ status: "error" });
  });

  test.each(cases)("$name does not take an answer without deleted: true as a deletion", async ({ call }) => {
    expect(await call(functionsClient({ data: { deleted: false }, error: null }).client)).toEqual({ status: "error" });
    expect(await call(functionsClient({ data: null, error: null }).client)).toEqual({ status: "error" });
  });
});

describe("movePage", () => {
  test("sends the page, the notebook and the chapter, and null for no chapter", async () => {
    const chapter = functionsClient({ data: { moved: true }, error: null });
    expect(await movePage(chapter.client, "p1", "n2", "c3")).toEqual({ status: "moved" });
    expect(chapter.invoke).toHaveBeenCalledWith("move-page", { body: { page_id: "p1", notebook_id: "n2", chapter_id: "c3" } });
    const none = functionsClient({ data: { moved: false }, error: null });
    expect(await movePage(none.client, "p1", "n2", null)).toEqual({ status: "moved" });
    expect(none.invoke).toHaveBeenCalledWith("move-page", { body: { page_id: "p1", notebook_id: "n2", chapter_id: null } });
  });

  test("tells a page being read, something gone, the network and the rest apart", async () => {
    expect(await movePage(functionsClient({ data: null, error: refusal(409, "page_processing") }).client, "p", "n", null)).toEqual({ status: "busy" });
    expect(await movePage(functionsClient({ data: null, error: refusal(404, "chapter_not_found") }).client, "p", "n", "c")).toEqual({ status: "missing" });
    expect(await movePage(functionsClient({ data: null, error: new FunctionsFetchError(new Error("offline")) }).client, "p", "n", null)).toEqual({ status: "network" });
    expect(await movePage(functionsClient({ data: null, error: refusal(400, "invalid_request") }).client, "p", "n", null)).toEqual({ status: "error" });
    expect(await movePage(functionsClient({ data: {}, error: null }).client, "p", "n", null)).toEqual({ status: "error" });
  });
});

describe("pages and chapters", () => {
  test("a listed page carries the chapter it is in, or none", async () => {
    const base = {
      notebook_id: "n1",
      status: "read",
      queue_reason: null,
      captured_at: "2026-09-26T12:32:00+00:00",
      uploaded_at: "2026-09-26T12:32:05+00:00",
      attempted_at: null,
      page_type: "text",
      page_texts: [],
    };
    const db = database({ data: [{ ...base, id: "a", chapter_id: "c1" }, { ...base, id: "b", chapter_id: null }], error: null });
    const pages = await listPages(db.client);
    expect(pages.map((page) => [page.id, page.chapterId])).toEqual([["a", "c1"], ["b", null]]);
    expect(db.queries[0].calls[0][1][0]).toContain("chapter_id");
  });

  test("a page whose chapter is not a text or null cannot be read", async () => {
    const row = { id: "a", notebook_id: "n1", chapter_id: 7, status: "read", queue_reason: null, captured_at: "2026-09-26T12:32:00+00:00", uploaded_at: "2026-09-26T12:32:05+00:00", attempted_at: null, page_type: "text", page_texts: [] };
    await expect(listPages(database({ data: [row], error: null }).client)).rejects.toThrow();
  });

  test("a created page goes into the chapter it is given, and into none otherwise", async () => {
    const withChapter = database({ data: { id: "p1" }, error: null });
    expect(await insertPage(withChapter.client, "n1", "2026-10-21T10:00:00.000Z", "c1")).toEqual({ status: "created", pageId: "p1" });
    expect(withChapter.queries[0].calls[0]).toEqual(["insert", [{ notebook_id: "n1", source: "camera", captured_at: "2026-10-21T10:00:00.000Z", chapter_id: "c1" }]]);
    const without = database({ data: { id: "p2" }, error: null });
    await insertPage(without.client, "n1", "2026-10-21T10:00:00.000Z", null);
    expect(without.queries[0].calls[0]).toEqual(["insert", [{ notebook_id: "n1", source: "camera", captured_at: "2026-10-21T10:00:00.000Z" }]]);
  });
});
