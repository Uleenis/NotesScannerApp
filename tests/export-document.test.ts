import {
  buildDocument,
  isExportable,
  planChapter,
  planNotebook,
  planPage,
  type ExportSource,
} from "@/export/document";
import type { NumberedPage } from "@/pages/pages";

function page(number: number, text: string | null, overrides: Partial<NumberedPage> = {}): NumberedPage {
  return {
    id: `page-${number}`,
    notebookId: "notebook-1",
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: new Date(2026, 8, number + 1).toISOString(),
    uploadedAt: new Date(2026, 8, number + 1).toISOString(),
    attemptedAt: null,
    text,
    pageType: "text",
    number,
    ...overrides,
  };
}

const label = (number: number) => `Page ${number}`;
const none: ReadonlyMap<string, ExportSource> = new Map();

describe("isExportable", () => {
  test("accepts a read page that has a text", () => {
    expect(isExportable(page(1, "Title\nline"))).toBe(true);
    expect(isExportable(page(1, "Title", { pageType: "math" }))).toBe(true);
  });

  test.each([
    ["a page not yet read", page(1, "Title", { status: "processing" })],
    ["a failed page", page(1, null, { status: "failed" })],
    ["a page without text", page(1, null)],
    ["a blank page", page(1, " \n  \n")],
    ["a page in an unsupported script", page(1, "Title", { pageType: "unsupported_script" })],
  ])("refuses %s", (_, candidate) => {
    expect(isExportable(candidate)).toBe(false);
  });
});

describe("plans", () => {
  const pages = [page(1, "One"), page(2, "Two"), page(3, "Three", { status: "failed" }), page(4, "Four")];

  test("a page plan holds that page alone", () => {
    expect(planPage("Histoire", pages[0])).toEqual({ kind: "page", name: "Histoire", sections: [{ heading: null, pages: [pages[0]] }] });
  });

  test("a chapter plan keeps the exportable pages in the order of the screen, newest first", () => {
    const plan = planChapter("Chapitre", pages);
    expect(plan.kind).toBe("chapter");
    expect(plan.sections).toEqual([{ heading: null, pages: [pages[3], pages[1], pages[0]] }]);
  });

  test("a notebook without chapters is one section", () => {
    const plan = planNotebook("Carnet", [], pages, "Pages outside a chapter");
    expect(plan.kind).toBe("notebook");
    expect(plan.sections).toEqual([{ heading: null, pages: [pages[3], pages[1], pages[0]] }]);
  });

  test("a notebook with chapters lists the chapters first, then the pages outside a chapter", () => {
    const inFirst = page(5, "Five", { chapterId: "c1" });
    const inSecond = page(6, "Six", { chapterId: "c2" });
    const olderInFirst = page(2, "Two", { chapterId: "c1" });
    const outside = page(7, "Seven");
    const plan = planNotebook(
      "Carnet",
      [
        { id: "c1", name: "Premier" },
        { id: "c2", name: "Second" },
      ],
      [outside, inSecond, olderInFirst, inFirst],
      "Hors chapitre",
    );
    expect(plan.sections).toEqual([
      { heading: "Premier", pages: [inFirst, olderInFirst] },
      { heading: "Second", pages: [inSecond] },
      { heading: "Hors chapitre", pages: [outside] },
    ]);
  });

  test("a chapter or the outside group without an exportable page is left out", () => {
    const plan = planNotebook("Carnet", [{ id: "c1", name: "Vide" }], [page(1, "One")], "Hors chapitre");
    expect(plan.sections).toEqual([{ heading: "Hors chapitre", pages: [page(1, "One")] }]);
  });

  test("a notebook with no exportable page has no section", () => {
    expect(planNotebook("Carnet", [], [page(1, null)], "Hors chapitre").sections).toEqual([]);
  });
});

describe("buildDocument", () => {
  test("a text page gives its title and its lines, with the underline tags removed", () => {
    const plan = planPage("N", page(1, "Magellan\n\nNationalité: <u>Portugaise</u>\nMort -> 1521"));
    const built = buildDocument(plan, none, label);
    expect(built.sections).toHaveLength(1);
    const exported = built.sections[0].pages[0];
    expect(exported.title).toBe("Magellan");
    expect(exported.blocks).toEqual([
      { kind: "line", parts: [{ kind: "text", text: "Nationalité: Portugaise" }] },
      { kind: "line", parts: [{ kind: "text", text: "Mort -> 1521" }] },
    ]);
  });

  test("a cut line is glued back like on the screen", () => {
    const plan = planPage("N", page(1, "T\nProjet -> atteindre les Indes orientales,\ndont iles Moluques"));
    const exported = buildDocument(plan, none, label).sections[0].pages[0];
    expect(exported.blocks).toEqual([{ kind: "line", parts: [{ kind: "text", text: "Projet -> atteindre les Indes orientales, dont iles Moluques" }] }]);
  });

  test("blank lines are kept as gaps, and none at the end", () => {
    const plan = planPage("N", page(1, "T\na\n\nb\n\n"));
    const exported = buildDocument(plan, none, label).sections[0].pages[0];
    expect(exported.blocks.map((block) => block.kind)).toEqual(["line", "gap", "line"]);
  });

  test("the second reading removes a blank line the first one invented", () => {
    const plan = planPage("N", page(1, "T\nAlpha\n\nBeta\nGamma"));
    const second: ReadonlyMap<string, ExportSource> = new Map([["page-1", { second: "T\nAlpha\nBeta\nGamma", edited: false }]]);
    const exported = buildDocument(plan, second, label).sections[0].pages[0];
    expect(exported.blocks.map((block) => block.kind)).toEqual(["line", "line", "line"]);
  });

  test("a page edited by the user keeps its blank lines", () => {
    const plan = planPage("N", page(1, "T\nAlpha\n\nBeta"));
    const second: ReadonlyMap<string, ExportSource> = new Map([["page-1", { second: "T\nAlpha\nBeta", edited: true }]]);
    const exported = buildDocument(plan, second, label).sections[0].pages[0];
    expect(exported.blocks.map((block) => block.kind)).toEqual(["line", "gap", "line"]);
  });

  test("a blank page gives no section", () => {
    const plan = planPage("N", page(4, "\n  \n"));
    expect(buildDocument(plan, none, label).sections).toEqual([]);
  });

  test("a math page gives its text and its formulas", () => {
    const plan = planPage("N", page(2, "Suites\nSoit $u_n = 2n$ et\n\\[ \\sum_{k=0}^{n} k \\]\nfin", { pageType: "math" }));
    const exported = buildDocument(plan, none, label).sections[0].pages[0];
    expect(exported.title).toBe("Suites");
    expect(exported.blocks).toEqual([
      {
        kind: "line",
        parts: [
          { kind: "text", text: "Soit " },
          { kind: "formula", tex: "u_n = 2n", source: "$u_n = 2n$" },
          { kind: "text", text: " et" },
        ],
      },
      { kind: "display", tex: " \\sum_{k=0}^{n} k ", source: "\\[ \\sum_{k=0}^{n} k \\]" },
      { kind: "line", parts: [{ kind: "text", text: "fin" }] },
    ]);
  });

  test("a math page whose first line is a formula has the label as its title", () => {
    const plan = planPage("N", page(9, "$x^2$ et la suite", { pageType: "math" }));
    const exported = buildDocument(plan, none, label).sections[0].pages[0];
    expect(exported.title).toBe("Page 9");
    expect(exported.blocks).toHaveLength(1);
  });

  test("keeps the sections and their headings in order", () => {
    const plan = planNotebook("Carnet", [{ id: "c1", name: "Premier" }], [page(1, "One", { chapterId: "c1" }), page(2, "Two")], "Hors chapitre");
    const built = buildDocument(plan, none, label);
    expect(built.name).toBe("Carnet");
    expect(built.kind).toBe("notebook");
    expect(built.sections.map((section) => [section.heading, section.pages.map((exported) => exported.title)])).toEqual([
      ["Premier", ["One"]],
      ["Hors chapitre", ["Two"]],
    ]);
  });

  test("never changes the text: the tags of the hostile text stay as typed", () => {
    const plan = planPage("N", page(1, "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n</style>"));
    const exported = buildDocument(plan, none, label).sections[0].pages[0];
    expect(exported.title).toBe("<script>alert(1)</script>");
    expect(exported.blocks).toEqual([
      { kind: "line", parts: [{ kind: "text", text: "<img src=x onerror=alert(1)>" }] },
      { kind: "line", parts: [{ kind: "text", text: "</style>" }] },
    ]);
  });
});
