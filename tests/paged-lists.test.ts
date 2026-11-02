import { listChapters, type ChapterClient } from "@/notebooks/chapters";
import { listNotebooks, type NotebookClient } from "@/notebooks/notebooks";
import { MAX_ROWS, PAGE_ROWS, readAllRows } from "@/lib/paged";
import { getPage, listPages, type PagesClient } from "@/pages/pages";

type Chunk = { data: unknown[] | null; error: { code: string } | null };

function builder(rows: unknown[], ranges: [number, number][], fail: number | null = null) {
  const self: unknown = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "range") {
          return (from: number, to: number): Promise<Chunk> => {
            ranges.push([from, to]);
            if (fail !== null && ranges.length === fail) {
              return Promise.resolve({ data: null, error: { code: "boom" } });
            }
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
          };
        }
        if (name === "then") {
          return undefined;
        }
        return () => self;
      },
    },
  );
  return { from: () => self };
}

function notebookRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `n${index}`, name: `Notebook ${index}`, pages: [{ count: 0 }] }));
}

function chapterRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `c${index}`, notebook_id: "n0", name: `Chapter ${index}`, pages: [{ count: 0 }] }));
}

function pageRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    notebook_id: "n0",
    chapter_id: null,
    status: "read",
    queue_reason: null,
    captured_at: "2026-10-01T10:00:00.000Z",
    uploaded_at: "2026-10-01T10:05:00.000Z",
    attempted_at: null,
    page_type: "text",
    page_texts: [{ text: `t${index}` }],
  }));
}

describe("readAllRows", () => {
  it("asks for consecutive ranges of the server limit until a range comes back short", async () => {
    const ranges: [number, number][] = [];
    const source = Array.from({ length: PAGE_ROWS * 2 + 5 }, (_, index) => index);
    const rows = await readAllRows(async (from, to) => ({ data: source.slice(from, to + 1), error: null }));
    expect(rows).toEqual(source);
    ranges.length = 0;
    await readAllRows(async (from, to) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    });
    expect(ranges).toEqual([
      [0, PAGE_ROWS - 1],
      [PAGE_ROWS, PAGE_ROWS * 2 - 1],
      [PAGE_ROWS * 2, PAGE_ROWS * 3 - 1],
    ]);
  });

  it("asks once more when the last range is exactly full", async () => {
    const source = Array.from({ length: PAGE_ROWS }, (_, index) => index);
    const ranges: number[] = [];
    const rows = await readAllRows(async (from, to) => {
      ranges.push(from);
      return { data: source.slice(from, to + 1), error: null };
    });
    expect(rows).toHaveLength(PAGE_ROWS);
    expect(ranges).toEqual([0, PAGE_ROWS]);
  });

  it("returns nothing when one range fails, never a part of the list", async () => {
    let calls = 0;
    const rows = await readAllRows(async () => {
      calls += 1;
      return calls === 2 ? { data: null, error: { code: "x" } } : { data: new Array<number>(PAGE_ROWS).fill(1), error: null };
    });
    expect(rows).toBeNull();
  });

  it("returns nothing when a range is not a list", async () => {
    expect(await readAllRows(async () => ({ data: { id: 1 }, error: null }))).toBeNull();
  });

  it("returns nothing when the list is longer than the bound", async () => {
    const rows = await readAllRows(async () => ({ data: new Array<number>(PAGE_ROWS).fill(1), error: null }));
    expect(rows).toBeNull();
    expect(MAX_ROWS % PAGE_ROWS).toBe(0);
  });
});

describe("the three lists", () => {
  it("reads every notebook past the server limit, in order", async () => {
    const ranges: [number, number][] = [];
    const notebooks = await listNotebooks(builder(notebookRows(2500), ranges) as unknown as NotebookClient);
    expect(notebooks).toHaveLength(2500);
    expect(notebooks[2499].id).toBe("n2499");
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("reads every chapter past the server limit", async () => {
    const ranges: [number, number][] = [];
    const chapters = await listChapters(builder(chapterRows(1001), ranges) as unknown as ChapterClient);
    expect(chapters).toHaveLength(1001);
    expect(ranges).toHaveLength(2);
  });

  it("reads every page past the server limit and numbers them", async () => {
    const ranges: [number, number][] = [];
    const pages = await listPages(builder(pageRows(1500), ranges) as unknown as PagesClient);
    expect(pages).toHaveLength(1500);
    expect(Math.max(...pages.map((page) => page.number))).toBe(1500);
    expect(ranges).toHaveLength(2);
  });

  it("numbers a page among every page of its notebook, past the server limit", async () => {
    const rows = pageRows(1500);
    const wanted = rows[1400];
    const ranges: [number, number][] = [];
    const siblings = rows.map((row, index) => ({ id: row.id, captured_at: `2026-10-01T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z` }));
    wanted.captured_at = siblings[1400].captured_at;
    const self: unknown = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === "maybeSingle") {
            return () => Promise.resolve({ data: wanted, error: null });
          }
          if (name === "range") {
            return (from: number, to: number) => {
              ranges.push([from, to]);
              return Promise.resolve({ data: siblings.slice(from, to + 1), error: null });
            };
          }
          if (name === "then") {
            return undefined;
          }
          return () => self;
        },
      },
    );
    const found = await getPage({ from: () => self } as unknown as PagesClient, wanted.id);
    expect(found?.number).toBe(1401);
    expect(ranges).toHaveLength(2);
  });

  it("fails when a later range fails", async () => {
    await expect(listNotebooks(builder(notebookRows(1500), [], 2) as unknown as NotebookClient)).rejects.toThrow();
    await expect(listChapters(builder(chapterRows(1500), [], 2) as unknown as ChapterClient)).rejects.toThrow();
    await expect(listPages(builder(pageRows(1500), [], 2) as unknown as PagesClient)).rejects.toThrow();
  });
});
