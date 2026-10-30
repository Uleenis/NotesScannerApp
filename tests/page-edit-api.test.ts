import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import { editPage } from "@/pages/edit";
import { listAlerts } from "@/pages/alerts";
import { readSecond } from "@/pages/second";
import type { PagesClient } from "@/pages/pages";

type Outcome = { data: unknown; error: unknown };

const functionsClient = (outcome: Outcome | (() => Promise<Outcome>)) => {
  const invoke = jest.fn(typeof outcome === "function" ? outcome : async () => outcome);
  return { client: { functions: { invoke } } as unknown as PagesClient, invoke };
};
const refusal = (status: number, error: string) => new FunctionsHttpError(new Response(JSON.stringify({ error }), { status }));

describe("editPage", () => {
  const words = [{ token_index: 1, text: "Pierre" }];
  const gaps = [{ gap_index: 2, text: ";" }];

  test("calls edit-page with the page, the text, the words and the gaps alone", async () => {
    const fake = functionsClient({ data: { edited: true }, error: null });
    expect(await editPage(fake.client, "page-1", "Bonjour Pierre;", words, gaps)).toEqual({ status: "saved" });
    expect(fake.invoke).toHaveBeenCalledWith("edit-page", { body: { page_id: "page-1", text: "Bonjour Pierre;", words, gaps } });
  });

  test("a page that changed meanwhile is told apart from another refusal", async () => {
    expect(await editPage(functionsClient({ data: null, error: refusal(409, "text_changed") }).client, "p", "x", [], [])).toEqual({ status: "changed" });
    for (const [status, code] of [
      [422, "invalid_edit"],
      [409, "not_editable"],
      [409, "page_not_read"],
      [409, "unsupported_script"],
      [404, "page_not_found"],
      [400, "invalid_request"],
    ] as const) {
      expect(await editPage(functionsClient({ data: null, error: refusal(status, code) }).client, "p", "x", [], [])).toEqual({ status: "refused" });
    }
  });

  test("no network is a network failure", async () => {
    expect(await editPage(functionsClient({ data: null, error: new FunctionsFetchError(new Error("offline")) }).client, "p", "x", [], [])).toEqual({ status: "network" });
    expect(await editPage(functionsClient(async () => Promise.reject(new TypeError("Network request failed"))).client, "p", "x", [], [])).toEqual({ status: "network" });
  });

  test("an answer that does not say it was edited, or another failure, is an error", async () => {
    expect(await editPage(functionsClient({ data: null, error: null }).client, "p", "x", [], [])).toEqual({ status: "error" });
    expect(await editPage(functionsClient({ data: { edited: false }, error: null }).client, "p", "x", [], [])).toEqual({ status: "error" });
    expect(await editPage(functionsClient({ data: null, error: new Error("boom") }).client, "p", "x", [], [])).toEqual({ status: "error" });
    expect(await editPage(functionsClient(async () => Promise.reject(new Error("boom"))).client, "p", "x", [], [])).toEqual({ status: "error" });
  });
});

describe("listAlerts", () => {
  function reader(outcome: Outcome) {
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order"]) {
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: Outcome) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcome).then(resolve, reject);
    const from = jest.fn((_table: string) => chain);
    return { client: { from } as unknown as PagesClient, from, calls };
  }

  test("reads the kinds of alert of the page and nothing else", async () => {
    const { client, from, calls } = reader({ data: [{ kind: "missing_line" }, { kind: "math_incomplete" }], error: null });
    expect(await listAlerts(client, "page-1")).toEqual(["missing_line", "math_incomplete"]);
    expect(from).toHaveBeenCalledWith("page_alerts");
    expect(calls).toContainEqual(["select", ["kind"]]);
    expect(calls).toContainEqual(["eq", ["page_id", "page-1"]]);
  });

  test("leaves out a kind the screen does not show", async () => {
    const { client } = reader({ data: [{ kind: "date_incoherent" }, { kind: "missing_line" }, { kind: "something" }], error: null });
    expect(await listAlerts(client, "page-1")).toEqual(["date_incoherent", "missing_line"]);
  });

  test.each([
    ["an error", { data: null, error: { message: "boom" } }],
    ["a result that is not a list", { data: {}, error: null }],
    ["a row without a kind", { data: [{}], error: null }],
  ])("fails on %s", async (_, outcome) => {
    await expect(listAlerts(reader(outcome).client, "page-1")).rejects.toThrow();
  });
});

describe("readSecond", () => {
  function reader(outcome: Outcome) {
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "limit"]) {
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: Outcome) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcome).then(resolve, reject);
    const from = jest.fn((_table: string) => chain);
    return { client: { from } as unknown as PagesClient, from, calls };
  }

  test("reads the text of the second reading of the page and nothing else", async () => {
    const { client, from, calls } = reader({ data: [{ raw_text: "Une Deux" }], error: null });
    expect(await readSecond(client, "page-1")).toBe("Une Deux");
    expect(from).toHaveBeenCalledWith("readings");
    expect(calls).toContainEqual(["select", ["raw_text"]]);
    expect(calls).toContainEqual(["eq", ["page_id", "page-1"]]);
    expect(calls).toContainEqual(["eq", ["label", "B2"]]);
    expect(calls).toContainEqual(["limit", [1]]);
  });

  test("is null while the second reading has not arrived", async () => {
    expect(await readSecond(reader({ data: [], error: null }).client, "page-1")).toBeNull();
  });

  test.each([
    ["an error", { data: null, error: { message: "boom" } }],
    ["a result that is not a list", { data: {}, error: null }],
    ["a row without text", { data: [{}], error: null }],
    ["a row whose text is not a string", { data: [{ raw_text: 3 }], error: null }],
  ])("fails on %s", async (_, outcome) => {
    await expect(readSecond(reader(outcome).client, "page-1")).rejects.toThrow();
  });
});
