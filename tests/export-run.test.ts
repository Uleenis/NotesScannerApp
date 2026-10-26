import { planChapter, planNotebook, planPage, type ExportSource } from "@/export/document";
import { MAX_EXPORT_FORMULAS, MAX_MARKDOWN_CHARS, MAX_MARKDOWN_PAGES, MAX_PDF_CHARS, MAX_PDF_PAGES, runExport, type ExportControl, type ExportDeps, type ExportLabels } from "@/export/run";
import type { NumberedPage } from "@/pages/pages";
import type { StoredRendering } from "@/render/api";
import type { DrawnTex } from "@/pages/tex";
import { MAX_FORMULAS_PER_PAGE } from "@/pages/tex";

function page(number: number, text: string | null, overrides: Partial<NumberedPage> = {}): NumberedPage {
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

const labels: ExportLabels = { pageNumber: (number) => `Page ${number}`, fallbackName: "notes", language: "fr", enriched: false };

const drawing: DrawnTex = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1ex" height="1ex"></svg>', width: 1, height: 1, shift: 0 };

function makeDeps(overrides: Partial<ExportDeps> = {}) {
  const discarded: string[] = [];
  const saved: { format: string; name: string; content: string }[] = [];
  const deps: ExportDeps = {
    sources: jest.fn(async (ids: string[]) => new Map<string, ExportSource>(ids.map((id) => [id, { second: null, edited: false }]))),
    renderings: jest.fn(async () => new Map<string, StoredRendering>()),
    draw: jest.fn(async () => drawing as DrawnTex | null),
    save: jest.fn(async (file) => {
      saved.push(file);
      return { uri: `file:///cache/${file.name}`, discard: () => void discarded.push(file.name) };
    }),
    share: jest.fn(async () => true),
    ...overrides,
  };
  return { deps, saved, discarded };
}

const live = (): ExportControl => ({ cancelled: false });

describe("runExport", () => {
  test("makes the Markdown of a chapter and shares it, leaving the file to the share target", async () => {
    const { deps, saved, discarded } = makeDeps();
    const plan = planChapter("Histoire de France", [page(1, "Un\nligne"), page(2, "Deux")]);

    const result = await runExport(plan, "markdown", labels, live(), deps);

    expect(result).toEqual({ status: "shared" });
    expect(deps.sources).toHaveBeenCalledWith(["page-2", "page-1"], expect.anything());
    expect(saved).toEqual([{ format: "markdown", name: "Histoire-de-France", content: "# Histoire de France\n\n## Deux\n\n## Un\n\nligne\n" }]);
    expect(deps.share).toHaveBeenCalledWith("file:///cache/Histoire-de-France", "markdown");
    expect(discarded).toEqual([]);
    expect(deps.draw).not.toHaveBeenCalled();
  });

  test("makes the PDF of a page with its formulas drawn", async () => {
    const { deps, saved } = makeDeps();
    const plan = planPage("Suites", page(1, "Suites\nSoit $x^2$ et\n\\[ y \\]", { pageType: "math" }));

    const result = await runExport(plan, "pdf", labels, live(), deps);

    expect(result).toEqual({ status: "shared" });
    expect(deps.draw).toHaveBeenCalledTimes(2);
    expect(deps.draw).toHaveBeenCalledWith("x^2", false);
    expect(deps.draw).toHaveBeenCalledWith(" y ", true);
    expect(saved).toHaveLength(1);
    expect(saved[0].format).toBe("pdf");
    expect(saved[0].name).toBe("Suites");
    expect(saved[0].content).toContain("<h1>Suites</h1>");
    expect(saved[0].content).toContain("data:image/svg+xml");
    expect(saved[0].content).toContain('<html lang="fr">');
  });

  test("draws a formula that comes twice once", async () => {
    const { deps } = makeDeps();
    const plan = planPage("N", page(1, "T\n$x^2$ et $x^2$ puis $y$", { pageType: "math" }));
    await runExport(plan, "pdf", labels, live(), deps);
    expect(deps.draw).toHaveBeenCalledTimes(2);
  });

  test("a formula that cannot be drawn stays as its source", async () => {
    const { deps, saved } = makeDeps({ draw: jest.fn(async () => null) });
    const plan = planPage("N", page(1, "T\nSoit $x^2$", { pageType: "math" }));
    expect(await runExport(plan, "pdf", labels, live(), deps)).toEqual({ status: "shared" });
    expect(saved[0].content).toContain("<code>$x^2$</code>");
  });

  test("draws at most the formulas of the page budget for each page", async () => {
    const { deps } = makeDeps();
    const formulas = Array.from({ length: MAX_FORMULAS_PER_PAGE + 20 }, (_, index) => `$a_${index}$`).join(" ");
    await runExport(planPage("N", page(1, `T\n${formulas}`, { pageType: "math" })), "pdf", labels, live(), deps);
    expect(deps.draw).toHaveBeenCalledTimes(MAX_FORMULAS_PER_PAGE);
  });

  test("draws at most the formulas of the export budget", async () => {
    const { deps } = makeDeps();
    const pages = Array.from({ length: 6 }, (_, index) =>
      page(index + 1, `T${index}\n${Array.from({ length: 90 }, (__, formula) => `$a_${index}_${formula}$`).join(" ")}`, { pageType: "math" }),
    );
    await runExport(planChapter("N", pages), "pdf", labels, live(), deps);
    expect(deps.draw).toHaveBeenCalledTimes(MAX_EXPORT_FORMULAS);
  });

  test("tells there is nothing to export and touches nothing", async () => {
    const { deps } = makeDeps();
    const plan = planNotebook("Carnet", [], [page(1, null), page(2, "x", { status: "failed" })], "Hors");
    expect(await runExport(plan, "pdf", labels, live(), deps)).toEqual({ status: "empty" });
    expect(deps.sources).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("refuses a PDF above the page limit before reading anything", async () => {
    const { deps } = makeDeps();
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) => page(index + 1, "T"));
    expect(await runExport(planChapter("N", pages), "pdf", labels, live(), deps)).toEqual({ status: "tooMany", max: MAX_PDF_PAGES });
    expect(deps.sources).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("accepts exactly the page limit of the PDF, and more Markdown pages", async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES }, (_, index) => page(index + 1, "T"));
    const first = makeDeps();
    expect(await runExport(planChapter("N", pages), "pdf", labels, live(), first.deps)).toEqual({ status: "shared" });
    const many = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) => page(index + 1, "T"));
    const second = makeDeps();
    expect(await runExport(planChapter("N", many), "markdown", labels, live(), second.deps)).toEqual({ status: "shared" });
    expect(MAX_MARKDOWN_PAGES).toBeGreaterThan(MAX_PDF_PAGES);
    const tooMany = Array.from({ length: MAX_MARKDOWN_PAGES + 1 }, (_, index) => page(index + 1, "T"));
    expect(await runExport(planChapter("N", tooMany), "markdown", labels, live(), makeDeps().deps)).toEqual({ status: "tooMany", max: MAX_MARKDOWN_PAGES });
  });

  test("names the file from a hostile name with the accepted characters only", async () => {
    const { deps, saved } = makeDeps();
    await runExport(planPage("../../<script>x</script>", page(1, "T")), "markdown", labels, live(), deps);
    expect(saved[0].name).toBe("script-x-script");
  });

  test("uses the fallback name when nothing acceptable is left", async () => {
    const { deps, saved } = makeDeps();
    await runExport(planPage("???", page(1, "T")), "markdown", labels, live(), deps);
    expect(saved[0].name).toBe("notes");
  });

  test("stops when it is cancelled while reading, and writes nothing", async () => {
    const control = live();
    const { deps } = makeDeps({
      sources: jest.fn(async () => {
        control.cancelled = true;
        return new Map<string, ExportSource>();
      }),
    });
    expect(await runExport(planPage("N", page(1, "T")), "markdown", labels, control, deps)).toEqual({ status: "cancelled" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.share).not.toHaveBeenCalled();
  });

  test("erases the file and does not share it when it is cancelled after writing", async () => {
    const control = live();
    const { deps, discarded } = makeDeps();
    jest.mocked(deps.save).mockImplementationOnce(async (file) => {
      control.cancelled = true;
      return { uri: "file:///cache/x", discard: () => void discarded.push(file.name) };
    });
    expect(await runExport(planPage("N", page(1, "T")), "markdown", labels, control, deps)).toEqual({ status: "cancelled" });
    expect(deps.share).not.toHaveBeenCalled();
    expect(discarded).toEqual(["N"]);
  });

  test("tells when the phone cannot share, and erases the file", async () => {
    const { deps, discarded } = makeDeps({ share: jest.fn(async () => false) });
    expect(await runExport(planPage("N", page(1, "T")), "markdown", labels, live(), deps)).toEqual({ status: "unavailable" });
    expect(discarded).toEqual(["N"]);
  });

  test("erases the file when sharing fails", async () => {
    const { deps, discarded } = makeDeps({
      share: jest.fn(async () => {
        throw new Error("no app");
      }),
    });
    expect(await runExport(planPage("N", page(1, "T")), "markdown", labels, live(), deps)).toEqual({ status: "error" });
    expect(discarded).toEqual(["N"]);
  });

  test.each(["sources", "save"] as const)("answers an error when %s fails", async (step) => {
    const failing = jest.fn(async () => {
      throw new Error("boom");
    });
    const { deps } = makeDeps({ [step]: failing });
    expect(await runExport(planPage("N", page(1, "T")), "pdf", labels, live(), deps)).toEqual({ status: "error" });
  });

  test("answers an error when drawing throws", async () => {
    const { deps } = makeDeps({
      draw: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await runExport(planPage("N", page(1, "T\n$x$", { pageType: "math" })), "pdf", labels, live(), deps)).toEqual({ status: "error" });
  });

  test("an error that comes after a Cancel is a cancel, not a failure", async () => {
    const control = live();
    const { deps } = makeDeps({
      sources: jest.fn(async () => {
        control.cancelled = true;
        throw new Error("network dropped");
      }),
    });
    expect(await runExport(planPage("N", page(1, "T")), "markdown", labels, control, deps)).toEqual({ status: "cancelled" });
  });

  test("gives the control to the reading of the sources", async () => {
    const { deps } = makeDeps();
    const control = live();
    await runExport(planPage("N", page(1, "T")), "markdown", labels, control, deps);
    expect(deps.sources).toHaveBeenCalledWith(["page-1"], control);
  });

  test("refuses a Markdown file that is too large before writing it", async () => {
    const { deps } = makeDeps();
    const text = `T
${"x".repeat(100_000)}`;
    const pages = Array.from({ length: 201 }, (_, index) => page(index + 1, text));
    expect(MAX_MARKDOWN_CHARS).toBeLessThan(201 * 100_000);
    expect(await runExport(planChapter("N", pages), "markdown", labels, live(), deps)).toEqual({ status: "tooLarge" });
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("refuses a PDF that is too large before printing it", async () => {
    const { deps } = makeDeps();
    const text = `T
${"'".repeat(100_000)}`;
    const pages = Array.from({ length: 100 }, (_, index) => page(index + 1, text));
    expect(MAX_PDF_CHARS).toBeLessThan(100 * 100_000 * 5);
    expect(await runExport(planChapter("N", pages), "pdf", labels, live(), deps)).toEqual({ status: "tooLarge" });
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("a page without a row in the sources is exported as it is", async () => {
    const { deps, saved } = makeDeps({ sources: jest.fn(async () => new Map<string, ExportSource>()) });
    expect(await runExport(planPage("N", page(1, "T\nligne")), "markdown", labels, live(), deps)).toEqual({ status: "shared" });
    expect(saved[0].content).toContain("ligne");
  });
});
