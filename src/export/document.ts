import { cleanView, stripUnderline } from "@/pages/clean";
import { displayDocument } from "@/pages/display";
import { mathDocument, type MathRow } from "@/pages/formulas";
import type { NumberedPage } from "@/pages/pages";
import { renderingFingerprint, type StoredRendering } from "@/render/api";
import { parseRendering, type RichBlock, type RichSpan } from "@/render/markdown";

export type ExportSource = { second: string | null; edited: boolean; rendering?: StoredRendering | null };

export type Part = { kind: "text"; text: string; bold?: boolean; italic?: boolean } | { kind: "formula"; tex: string; source: string };

export type Block =
  | { kind: "line"; parts: Part[] }
  | { kind: "paragraph"; parts: Part[] }
  | { kind: "heading"; level: 1 | 2 | 3; parts: Part[] }
  | { kind: "item"; depth: 0 | 1; marker: number | null; parts: Part[] }
  | { kind: "display"; tex: string; source: string }
  | { kind: "gap" };

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

function richParts(spans: RichSpan[]): Part[] {
  return spans.map((span): Part => {
    if (span.kind === "formula") {
      return { kind: "formula", tex: span.tex, source: span.source };
    }
    return { kind: "text", text: span.text, ...(span.bold ? { bold: true } : {}), ...(span.italic ? { italic: true } : {}) };
  });
}

function richBlock(block: RichBlock, titleLevel: number): Block {
  switch (block.kind) {
    case "display":
      return block;
    case "heading":
      return { kind: "heading", level: Math.max(1, block.level - titleLevel) as 1 | 2 | 3, parts: richParts(block.spans) };
    case "item":
      return { kind: "item", depth: block.depth, marker: block.marker, parts: richParts(block.spans) };
    case "paragraph":
      return { kind: "paragraph", parts: richParts(block.spans) };
  }
}

function plainSpans(spans: RichSpan[]): string {
  return spans.map((span) => (span.kind === "text" ? span.text : span.source)).join("");
}

function richPage(page: NumberedPage, rich: RichBlock[], pageNumber: (number: number) => string): ExportedPage {
  const first = rich[0];
  if (first.kind === "heading") {
    return { id: page.id, title: plainSpans(first.spans), blocks: rich.slice(1).map((block) => richBlock(block, first.level)) };
  }
  return { id: page.id, title: pageNumber(page.number), blocks: rich.map((block) => richBlock(block, 0)) };
}

function exportedPage(page: NumberedPage, source: ExportSource | undefined, pageNumber: (number: number) => string, enriched: boolean): ExportedPage {
  const text = page.text ?? "";
  if (enriched && source?.rendering != null && source.rendering.basedOn === renderingFingerprint(text)) {
    const rich = parseRendering(source.rendering.text);
    if (rich !== null && rich.length > 0) {
      return richPage(page, rich, pageNumber);
    }
  }
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
  return exportedPage(page, undefined, pageNumber, false).title;
}

export function buildDocument(plan: ExportPlan, sources: ReadonlyMap<string, ExportSource>, pageNumber: (number: number) => string, enriched = false): ExportDocument {
  const sections = plan.sections
    .map((section) => ({
      heading: section.heading,
      pages: section.pages.filter(isExportable).map((page) => exportedPage(page, sources.get(page.id), pageNumber, enriched)),
    }))
    .filter((section) => section.pages.length > 0);
  return { kind: plan.kind, name: plan.name, sections };
}
