import { beginExport, cancelExport, currentExport, endExport } from "@/export/activity";
import { formulaKey, MAX_EMBEDDED_CHARS, toHtml } from "@/export/html";
import { buildDocument, pageName, planPage, type ExportDocument } from "@/export/document";
import { readExportSources } from "@/export/sources";
import type { NumberedPage } from "@/pages/pages";
import type { DrawnTex } from "@/pages/tex";

function page(text: string | null, overrides: Partial<NumberedPage> = {}): NumberedPage {
  return {
    id: "page-1",
    notebookId: "notebook-1",
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: "2026-09-26T14:32:00.000Z",
    uploadedAt: "2026-09-26T14:32:05.000Z",
    attemptedAt: null,
    text,
    pageType: "text",
    number: 3,
    ...overrides,
  };
}

describe("the running export", () => {
  afterEach(() => {
    const running = currentExport();
    if (running !== null) {
      endExport(running);
    }
  });

  test("allows one export at a time", () => {
    const first = beginExport();
    expect(first).not.toBeNull();
    expect(currentExport()).toBe(first);
    expect(beginExport()).toBeNull();
    endExport(first!);
    expect(currentExport()).toBeNull();
    expect(beginExport()).not.toBeNull();
  });

  test("a cancel hides the wait and flags the run, but no other export starts before it ends", () => {
    const first = beginExport()!;
    cancelExport();
    expect(first.cancelled).toBe(true);
    expect(currentExport()).toBeNull();
    expect(beginExport()).toBeNull();
    endExport(first);
    const next = beginExport();
    expect(next).not.toBeNull();
    expect(next?.cancelled).toBe(false);
    endExport(next!);
  });

  test("the end of an old run does not end a newer one", () => {
    const first = beginExport()!;
    endExport(first);
    const second = beginExport()!;
    endExport(first);
    expect(currentExport()).toBe(second);
    endExport(second);
  });
});

describe("the embedded drawings of a PDF", () => {
  function documentWith(count: number): ExportDocument {
    return {
      kind: "page",
      name: "N",
      sections: [
        {
          heading: null,
          pages: [
            {
              id: "p",
              title: "T",
              blocks: Array.from({ length: count }, () => ({ kind: "display" as const, tex: "x", source: "$$x$$" })),
            },
          ],
        },
      ],
    };
  }

  test("stops embedding once the budget is spent and shows the source of the rest", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${"a".repeat(1_000_000)}</svg>`;
    const drawn: DrawnTex = { svg, width: 1, height: 1, shift: 0 };
    const html = toHtml(documentWith(12), new Map([[formulaKey("x", true), drawn]]), "en");
    const embedded = (html.match(/<img /g) ?? []).length;
    expect(embedded).toBe(Math.floor(MAX_EMBEDDED_CHARS / 1_000_060));
    expect(embedded).toBeLessThan(12);
    expect((html.match(/<code>/g) ?? []).length).toBe(12 - embedded);
  });

  test("a drawing that cannot be encoded becomes the source of the formula", () => {
    const drawn: DrawnTex = { svg: "<svg>\ud83d</svg>", width: 1, height: 1, shift: 0 };
    const html = toHtml(documentWith(1), new Map([[formulaKey("x", true), drawn]]), "en");
    expect(html).not.toContain("<img");
    expect(html).toContain("<code>$$x$$</code>");
  });
});

describe("the sources of an export that is cancelled", () => {
  test("stops reading between groups once cancelled", async () => {
    const queries: string[] = [];
    const control = { cancelled: false };
    const client = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => {
            queries.push(table);
            control.cancelled = true;
            return Promise.resolve({ data: [], error: null });
          },
          limit: () => {
            queries.push(table);
            return Promise.resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };
    const ids = Array.from({ length: 120 }, (_, index) => `page-${index}`);

    await readExportSources(client as never, ids, control);

    expect(queries).toEqual(["readings"]);
  });
});

describe("the name and the content of a page", () => {
  const label = (number: number) => `Page ${number}`;

  test("the name of a math page is its heading, not its first formula", () => {
    expect(pageName(page("$x^2$ et la suite", { pageType: "math" }), label)).toBe("Page 3");
    expect(pageName(page("Suites\n$x$", { pageType: "math" }), label)).toBe("Suites");
    expect(pageName(page("Magellan\nligne"), label)).toBe("Magellan");
  });

  test("a page that holds only underline tags is not exported", () => {
    const only = page("<u></u>\n<u> </u>");
    expect(buildDocument(planPage("N", only), new Map(), label).sections).toEqual([]);
  });
});
