import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

import type { PagesClient } from "@/pages/pages";
import { MAX_RENDERINGS_PER_READ, readRendering, readRenderings, renderingFingerprint, renderPage } from "@/render/api";
import { sha256 } from "@/render/sha256";

type Outcome = { data: unknown; error: unknown };

function functionsClient(outcome: Outcome | (() => Promise<Outcome>)) {
  const invoke = jest.fn(typeof outcome === "function" ? outcome : async () => outcome);
  return { client: { functions: { invoke } } as unknown as PagesClient, invoke };
}

function tableClient(answer: (ids: string[]) => Outcome) {
  const calls: { table: string; columns: string; ids: string[] }[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_column: string, id: string) => ({
          limit: async () => {
            calls.push({ table, columns, ids: [id] });
            return answer([id]);
          },
        }),
        in: async (_column: string, ids: string[]) => {
          calls.push({ table, columns, ids });
          return answer(ids);
        },
      }),
    }),
  } as unknown as PagesClient;
  return { client, calls };
}

describe("renderPage", () => {
  it("calls render-page with the page alone", async () => {
    const fake = functionsClient({ data: { status: "ready", text: "# Titre" }, error: null });
    expect(await renderPage(fake.client, "page-1")).toEqual({ status: "ready", text: "# Titre" });
    expect(fake.invoke).toHaveBeenCalledWith("render-page", { body: { page_id: "page-1" } });
  });

  it.each(["limit", "failed", "discarded"] as const)("passes on the answer %s", async (status) => {
    expect(await renderPage(functionsClient({ data: { status }, error: null }).client, "p")).toEqual({ status });
  });

  it("takes an answer of another shape, or a ready one without text, for an error", async () => {
    for (const data of [null, {}, { status: "other" }, { status: "ready" }, { status: "ready", text: "" }, { status: "ready", text: 3 }, "ready"]) {
      expect(await renderPage(functionsClient({ data, error: null }).client, "p")).toEqual({ status: "error" });
    }
  });

  it("tells a refusal, a lost network and another failure apart", async () => {
    const refusal = new FunctionsHttpError(new Response(JSON.stringify({ error: "page_not_read" }), { status: 409 }));
    expect(await renderPage(functionsClient({ data: null, error: refusal }).client, "p")).toEqual({ status: "error" });
    expect(await renderPage(functionsClient({ data: null, error: new FunctionsFetchError(new Error("offline")) }).client, "p")).toEqual({ status: "network" });
    expect(await renderPage(functionsClient(async () => Promise.reject(new TypeError("Network request failed"))).client, "p")).toEqual({ status: "network" });
    expect(await renderPage(functionsClient(async () => Promise.reject(new Error("boom"))).client, "p")).toEqual({ status: "error" });
  });
});

describe("renderingFingerprint", () => {
  it("is the SHA-256 of the stored text without the underline tags", () => {
    expect(renderingFingerprint("<u>La</u> France\n\nfin")).toBe(sha256("La France\n\nfin"));
    expect(renderingFingerprint("a <b> c")).toBe(sha256("a <b> c"));
    expect(renderingFingerprint("<u>La</u> France\n\nfin")).toBe("aecdca09dd4eaf5d22f3d6261a949f7974797523dc52b2df56ff53a7b97822b8");
  });
});

describe("readRendering", () => {
  it("reads the rendering of a page", async () => {
    const fake = tableClient(() => ({ data: [{ text: "# T", based_on: "f".repeat(64) }], error: null }));
    expect(await readRendering(fake.client, "page-1")).toEqual({ text: "# T", basedOn: "f".repeat(64) });
    expect(fake.calls).toEqual([{ table: "page_renderings", columns: "text, based_on", ids: ["page-1"] }]);
  });

  it("answers null when there is none and throws on a failure or a row of another shape", async () => {
    expect(await readRendering(tableClient(() => ({ data: [], error: null })).client, "p")).toBeNull();
    await expect(readRendering(tableClient(() => ({ data: null, error: new Error("x") })).client, "p")).rejects.toThrow();
    await expect(readRendering(tableClient(() => ({ data: [{ text: 3, based_on: "x" }], error: null })).client, "p")).rejects.toThrow();
  });
});

describe("readRenderings", () => {
  it("reads the renderings of many pages in groups", async () => {
    const ids = Array.from({ length: MAX_RENDERINGS_PER_READ * 2 + 1 }, (_, at) => `page-${at}`);
    const fake = tableClient((asked) => ({ data: asked.filter((id) => id !== "page-3").map((id) => ({ page_id: id, text: `t ${id}`, based_on: "a".repeat(64) })), error: null }));
    const found = await readRenderings(fake.client, ids);
    expect(fake.calls.map((call) => call.ids.length)).toEqual([MAX_RENDERINGS_PER_READ, MAX_RENDERINGS_PER_READ, 1]);
    expect(fake.calls[0].columns).toBe("page_id, text, based_on");
    expect(found.size).toBe(ids.length - 1);
    expect(found.get("page-4")).toEqual({ text: "t page-4", basedOn: "a".repeat(64) });
    expect(found.has("page-3")).toBe(false);
  });

  it("reads nothing for no page and stops when told to", async () => {
    const fake = tableClient(() => ({ data: [], error: null }));
    expect((await readRenderings(fake.client, [])).size).toBe(0);
    expect(fake.calls).toEqual([]);
    await readRenderings(fake.client, ["a"], { cancelled: true });
    expect(fake.calls).toEqual([]);
  });

  it("throws on a failure or a row of another shape", async () => {
    await expect(readRenderings(tableClient(() => ({ data: null, error: new Error("x") })).client, ["a"])).rejects.toThrow();
    await expect(readRenderings(tableClient(() => ({ data: [{ page_id: "a", text: null, based_on: "x" }], error: null })).client, ["a"])).rejects.toThrow();
  });
});
