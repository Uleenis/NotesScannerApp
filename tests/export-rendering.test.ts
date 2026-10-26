import { buildDocument, planChapter, planPage, type ExportSource } from "@/export/document";
import { toHtml } from "@/export/html";
import { toMarkdown } from "@/export/markdown";
import { runExport, type ExportControl, type ExportDeps, type ExportLabels } from "@/export/run";
import type { NumberedPage } from "@/pages/pages";
import { renderingFingerprint, type StoredRendering } from "@/render/api";

const RAW = "Les suites\nUne suite converge si elle est bornée.\nExemples\nLa suite 1/n";
const RENDERED = "# Les suites\n\nUne suite **converge** si elle est *bornée*.\n\n## Exemples\n\n- La suite 1/n\n  - un terme\n\n1. fin";

function page(number: number, text: string, overrides: Partial<NumberedPage> = {}): NumberedPage {
  return {
    id: `page-${number}`,
    notebookId: "notebook-1",
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: new Date(2026, 8, 1, 10, number).toISOString(),
    uploadedAt: new Date(2026, 8, 1, 10, number).toISOString(),
    attemptedAt: null,
    text,
    pageType: "text",
    number,
    ...overrides,
  };
}

const label = (number: number) => `Page ${number}`;

function sources(id: string, rendering: StoredRendering | null): ReadonlyMap<string, ExportSource> {
  return new Map([[id, { second: null, edited: false, rendering }]]);
}

const current = (text: string = RENDERED): StoredRendering => ({ text, basedOn: renderingFingerprint(RAW) });

function exported(rendering: StoredRendering | null, enriched = true, raw = RAW) {
  const only = page(1, raw);
  return buildDocument(planPage("Cours", only), sources(only.id, rendering), label, enriched).sections[0].pages[0];
}

describe("an exported page in the enriched mode [7]", () => {
  test("takes its title and blocks from the stored rendering when it is current", () => {
    const result = exported(current());
    expect(result.title).toBe("Les suites");
    expect(result.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading", "item", "item", "item"]);
  });

  test("keeps the faithful text when the stored rendering is for another text", () => {
    const result = exported({ text: RENDERED, basedOn: renderingFingerprint("autre") });
    expect(result.title).toBe("Les suites");
    expect(result.blocks.every((block) => block.kind === "line" || block.kind === "gap")).toBe(true);
  });

  test("keeps the faithful text without a stored rendering, in the faithful mode, or with an unreadable one", () => {
    for (const result of [exported(null), exported(current(), false), exported(current("  \n ")), exported(current("a".repeat(60_001)))]) {
      expect(result.blocks.every((block) => block.kind === "line" || block.kind === "gap")).toBe(true);
    }
  });

  test("compares with the stored text without its underline tags, as the server does", () => {
    const tagged = "<u>Les suites</u>\nUne suite converge si elle est bornée.\nExemples\nLa suite 1/n";
    expect(exported(current(), true, tagged).blocks.some((block) => block.kind === "heading")).toBe(true);
  });

  test("uses the page number as title when the rendering does not start with a heading", () => {
    const result = exported(current("Une suite converge.\n\n- a"));
    expect(result.title).toBe("Page 1");
    expect(result.blocks.map((block) => block.kind)).toEqual(["paragraph", "item"]);
  });
});

describe("the Markdown of a rendering", () => {
  const markdown = (text: string = RENDERED, chapter = false) => {
    const only = page(1, RAW);
    const plan = chapter ? planChapter("Chap", [only]) : planPage("Cours", only);
    return toMarkdown(buildDocument(plan, sources(only.id, current(text)), label, true));
  };

  test("writes the headings, lists and emphasis with the accepted marks", () => {
    expect(markdown()).toBe("# Les suites\n\nUne suite **converge** si elle est *bornée*.\n\n## Exemples\n\n- La suite 1/n\n    - un terme\n1. fin\n");
  });

  test("puts the headings under the level of the page", () => {
    expect(markdown("# A\n\n## B\n\n### C", true)).toBe("# Chap\n\n## A\n\n### B\n\n#### C\n");
    expect(markdown("# A\n\n### B\n\n### C").split("\n").filter((line) => line.startsWith("#"))).toEqual(["# A", "### B", "### C"]);
    expect(markdown("Début\n\n# H1\n\n## H2").split("\n").filter((line) => line.startsWith("#"))).toEqual(["# Page 1", "## H1", "### H2"]);
  });

  test("keeps the spaces of an emphasis outside its marks", () => {
    expect(markdown("# T\n\nSoit **$y$ borné** ici")).toBe("# T\n\nSoit $y$ **borné** ici\n");
  });

  test("escapes every text, hostile or not", () => {
    const written = markdown("# <b>T</b>\n\n<script>alert(1)</script> [x](javascript:alert(1)) **<img src=x onerror=1>**\n\n- # titre\n- - sous");
    expect(written).not.toMatch(/(^|[^\\])[<>]/m);
    expect(written).toContain("\\<script\\>");
    expect(written).toContain("\\[x\\](javascript:alert(1))");
    expect(written).toContain("- \\# titre");
    expect(written).toContain("- \\- sous");
    expect(written.startsWith("# \\<b\\>T\\</b\\>\n")).toBe(true);
  });

  test("writes a formula as in the faithful mode", () => {
    expect(markdown("# T\n\nSoit $x^2$ ici\n\n$$a+b$$")).toBe("# T\n\nSoit $x^2$ ici\n\n$$\na+b\n$$\n");
  });
});

describe("the HTML of a rendering", () => {
  const html = (text: string) => {
    const only = page(1, RAW);
    return toHtml(buildDocument(planPage("Cours", only), sources(only.id, current(text)), label, true), new Map(), "fr");
  };

  test("writes headings, emphasis and items with fixed tags", () => {
    const written = html(RENDERED);
    expect(written).toContain("<h1>Les suites</h1>");
    expect(written).toContain("<p>Une suite <strong>converge</strong> si elle est <em>bornée</em>.</p>");
    expect(written).toContain('<h2 class="rich">Exemples</h2>');
    expect(written).toContain('<p class="item">• La suite 1/n</p>');
    expect(written).toContain('<p class="item nested">• un terme</p>');
    expect(written).toContain('<p class="item">1. fin</p>');
  });

  test("escapes the text, so no tag of the rendering survives", () => {
    const written = html("# <script>alert(1)</script>\n\n**<img src=x onerror=1>** *a & b*\n\n- <b>x</b>");
    expect(written).not.toContain("<script>alert");
    expect(written).not.toContain("<img src=x");
    expect(written).not.toContain("<b>x</b>");
    expect(written).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(written).toContain("<em>a &amp; b</em>");
  });
});

describe("runExport in the enriched mode", () => {
  const labels = (enriched: boolean): ExportLabels => ({ pageNumber: label, fallbackName: "notes", language: "fr", enriched });
  const live = (): ExportControl => ({ cancelled: false });

  function deps(rendering: StoredRendering | null) {
    const saved: string[] = [];
    const made: ExportDeps = {
      sources: jest.fn(async (ids: string[]) => new Map<string, ExportSource>(ids.map((id) => [id, { second: null, edited: false }]))),
      renderings: jest.fn(async (ids: string[]) => new Map<string, StoredRendering>(rendering === null ? [] : ids.map((id) => [id, rendering]))),
      draw: jest.fn(async () => null),
      save: jest.fn(async (file) => {
        saved.push(file.content);
        return { uri: "file:///cache/a", discard: () => undefined };
      }),
      share: jest.fn(async () => true),
    };
    return { made, saved };
  }

  test("reads the stored renderings and writes the enriched page, with no call of the model", async () => {
    const { made, saved } = deps(current());
    const result = await runExport(planPage("Cours", page(1, RAW)), "markdown", labels(true), live(), made);

    expect(result).toEqual({ status: "shared" });
    expect(made.renderings).toHaveBeenCalledWith(["page-1"], expect.anything());
    expect(saved[0]).toContain("Une suite **converge**");
  });

  test("reads no rendering in the faithful mode", async () => {
    const { made, saved } = deps(current());
    await runExport(planPage("Cours", page(1, RAW)), "markdown", labels(false), live(), made);

    expect(made.renderings).not.toHaveBeenCalled();
    expect(saved[0]).not.toContain("**");
  });

  test("falls back to the faithful text of a page whose rendering is old", async () => {
    const { made, saved } = deps({ text: RENDERED, basedOn: renderingFingerprint("autre") });
    await runExport(planPage("Cours", page(1, RAW)), "markdown", labels(true), live(), made);

    expect(saved[0]).not.toContain("**");
    expect(saved[0]).toContain("bornée.");
  });

  test("a PDF of a rendering keeps the headings and the emphasis, and counts the formulas of its blocks", async () => {
    const { made, saved } = deps(current("# T\n\nSoit $x^2$ et **fort**"));
    await runExport(planPage("Cours", page(1, RAW)), "pdf", labels(true), live(), made);

    expect(saved[0]).toContain("<strong>fort</strong>");
    expect(made.draw).toHaveBeenCalledWith("x^2", false);
  });

  test("a failure to read the renderings is an export error and shares nothing", async () => {
    const { made } = deps(current());
    jest.mocked(made.renderings).mockRejectedValue(new Error("down"));
    const result = await runExport(planPage("Cours", page(1, RAW)), "markdown", labels(true), live(), made);

    expect(result).toEqual({ status: "error" });
    expect(made.share).not.toHaveBeenCalled();
  });
});
