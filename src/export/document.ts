import { cleanView, stripUnderline } from "@/pages/clean";
import { displayDocument } from "@/pages/display";
import { mathDocument, type MathRow } from "@/pages/formulas";
import type { NumberedPage } from "@/pages/pages";

export type ExportSource = { second: string | null; edited: boolean };

export type Part = { kind: "text"; text: string } | { kind: "formula"; tex: string; source: string };

export type Block = { kind: "line"; parts: Part[] } | { kind: "display"; tex: string; source: string } | { kind: "gap" };

export type ExportedPage = { id: string; title: string; blocks: Block[] };

export type ExportSection = { heading: string | null; pages: ExportedPage[] };

export type ExportKind = "page" | "chapter" | "notebook";

export type ExportDocument = { kind: ExportKind; name: string; sections: ExportSection[] };

export type PlanSection = { heading: string | null; pages: NumberedPage[] };

export type ExportPlan = { kind: ExportKind; name: string; sections: PlanSection[] };

export function isExportable(page: NumberedPage): boolean {
  return page.status === "read" && page.pageType !== "unsupported_script" && page.text !== null && stripUnderline(page.text).trim() !== "";
}

function newestFirst(pages: NumberedPage[]): NumberedPage[] {
  return pages.filter(isExportable).sort((a, b) => b.number - a.number);
}

export function planPage(name: string, page: NumberedPage): ExportPlan {
  return { kind: "page", name, sections: [{ heading: null, pages: [page] }] };
}

export function planChapter(name: string, pages: NumberedPage[]): ExportPlan {
  return { kind: "chapter", name, sections: [{ heading: null, pages: newestFirst(pages) }] };
}

export function planNotebook(name: string, chapters: { id: string; name: string }[], pages: NumberedPage[], outsideHeading: string): ExportPlan {
  const inChapters = chapters.map((chapter) => ({ heading: chapter.name, pages: newestFirst(pages.filter((page) => page.chapterId === chapter.id)) }));
  const known = new Set(chapters.map((chapter) => chapter.id));
  const outside = newestFirst(pages.filter((page) => page.chapterId === null || !known.has(page.chapterId)));
  const sections: PlanSection[] =
    chapters.length === 0
      ? [{ heading: null, pages: outside }]
      : [...inChapters, { heading: outsideHeading, pages: outside }];
  return { kind: "notebook", name, sections: sections.filter((section) => section.pages.length > 0) };
}

function rowBlock(row: MathRow): Block {
  if (row.kind === "gap") {
    return row;
  }
  if (row.kind === "display") {
    return { kind: "display", tex: row.tex, source: row.source };
  }
  return {
    kind: "line",
    parts: row.parts.map((part): Part => (part.kind === "text" ? part : { kind: "formula", tex: part.tex, source: part.source })),
  };
}

function exportedPage(page: NumberedPage, source: ExportSource | undefined, pageNumber: (number: number) => string): ExportedPage {
  const text = page.text ?? "";
  if (page.pageType === "math") {
    const math = mathDocument(text);
    return { id: page.id, title: math.title ?? pageNumber(page.number), blocks: math.rows.map(rowBlock) };
  }
  const tightened = source !== undefined && !source.edited ? source.second : null;
  const laid = displayDocument(cleanView(text, [], tightened).text);
  return {
    id: page.id,
    title: laid.title ?? pageNumber(page.number),
    blocks: laid.blocks.map((block): Block => (block.kind === "gap" ? block : { kind: "line", parts: [{ kind: "text", text: block.text }] })),
  };
}

export function pageName(page: NumberedPage, pageNumber: (number: number) => string): string {
  return exportedPage(page, undefined, pageNumber).title;
}

export function buildDocument(plan: ExportPlan, sources: ReadonlyMap<string, ExportSource>, pageNumber: (number: number) => string): ExportDocument {
  const sections = plan.sections
    .map((section) => ({
      heading: section.heading,
      pages: section.pages.filter(isExportable).map((page) => exportedPage(page, sources.get(page.id), pageNumber)),
    }))
    .filter((section) => section.pages.length > 0);
  return { kind: plan.kind, name: plan.name, sections };
}
