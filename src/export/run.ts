import { MAX_FORMULAS_PER_PAGE, type DrawnTex } from "@/pages/tex";
import { buildDocument, isExportable, type Block, type ExportDocument, type ExportPlan, type ExportSource } from "./document";
import type { ExportFile, ExportFormat, SavedExport } from "./files";
import { formulaKey, toHtml, type Drawings } from "./html";
import { toMarkdown } from "./markdown";
import { exportFileName } from "./text";

export type { ExportFormat } from "./files";

export const MAX_PDF_PAGES = 100;
export const MAX_MARKDOWN_PAGES = 500;
export const MAX_EXPORT_FORMULAS = 300;
export const MAX_PDF_CHARS = 12_000_000;
export const MAX_MARKDOWN_CHARS = 20_000_000;

export type ExportLabels = { pageNumber: (number: number) => string; fallbackName: string; language: "en" | "fr" };

export type ExportControl = { cancelled: boolean };

export type ExportDeps = {
  sources: (ids: string[], control: ExportControl) => Promise<Map<string, ExportSource>>;
  draw: (tex: string, display: boolean) => Promise<DrawnTex | null>;
  save: (file: ExportFile) => Promise<SavedExport>;
  share: (uri: string, format: ExportFormat) => Promise<boolean>;
};

export type ExportResult =
  | { status: "shared" }
  | { status: "empty" }
  | { status: "tooMany"; max: number }
  | { status: "tooLarge" }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "error" };

function limitFormulas(document: ExportDocument): ExportDocument {
  let total = 0;
  const allowed = (usedOnPage: number): boolean => usedOnPage < MAX_FORMULAS_PER_PAGE && total < MAX_EXPORT_FORMULAS;
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      pages: section.pages.map((page) => {
        let onPage = 0;
        const blocks = page.blocks.map((block): Block => {
          if (block.kind === "display") {
            if (allowed(onPage)) {
              onPage += 1;
              total += 1;
              return block;
            }
            return { kind: "line", parts: [{ kind: "text", text: block.source }] };
          }
          if (block.kind === "gap") {
            return block;
          }
          return {
            kind: "line",
            parts: block.parts.map((part) => {
              if (part.kind === "text") {
                return part;
              }
              if (allowed(onPage)) {
                onPage += 1;
                total += 1;
                return part;
              }
              return { kind: "text" as const, text: part.source };
            }),
          };
        });
        return { ...page, blocks };
      }),
    })),
  };
}

function formulasOf(document: ExportDocument): { tex: string; display: boolean }[] {
  const found = new Map<string, { tex: string; display: boolean }>();
  for (const section of document.sections) {
    for (const page of section.pages) {
      for (const block of page.blocks) {
        if (block.kind === "display") {
          found.set(formulaKey(block.tex, true), { tex: block.tex, display: true });
        } else if (block.kind === "line") {
          for (const part of block.parts) {
            if (part.kind === "formula") {
              found.set(formulaKey(part.tex, false), { tex: part.tex, display: false });
            }
          }
        }
      }
    }
  }
  return [...found.values()];
}

async function drawAll(document: ExportDocument, draw: ExportDeps["draw"], control: ExportControl): Promise<Drawings | null> {
  const drawings = new Map<string, DrawnTex | null>();
  for (const { tex, display } of formulasOf(document)) {
    if (control.cancelled) {
      return null;
    }
    drawings.set(formulaKey(tex, display), await draw(tex, display));
  }
  return drawings;
}

async function content(document: ExportDocument, format: ExportFormat, labels: ExportLabels, deps: ExportDeps, control: ExportControl): Promise<string | null> {
  if (format === "markdown") {
    return toMarkdown(document);
  }
  const limited = limitFormulas(document);
  const drawings = await drawAll(limited, deps.draw, control);
  return drawings === null ? null : toHtml(limited, drawings, labels.language);
}

async function prepare(
  plan: ExportPlan,
  format: ExportFormat,
  labels: ExportLabels,
  control: ExportControl,
  deps: ExportDeps,
): Promise<ExportResult | { status: "ready"; file: ExportFile }> {
  const ids = plan.sections.flatMap((section) => section.pages.filter(isExportable).map((page) => page.id));
  if (ids.length === 0) {
    return { status: "empty" };
  }
  const max = format === "pdf" ? MAX_PDF_PAGES : MAX_MARKDOWN_PAGES;
  if (ids.length > max) {
    return { status: "tooMany", max };
  }
  const sources = await deps.sources(ids, control);
  if (control.cancelled) {
    return { status: "cancelled" };
  }
  const document = buildDocument(plan, sources, labels.pageNumber);
  const text = await content(document, format, labels, deps, control);
  if (text === null || control.cancelled) {
    return { status: "cancelled" };
  }
  if (text.length > (format === "pdf" ? MAX_PDF_CHARS : MAX_MARKDOWN_CHARS)) {
    return { status: "tooLarge" };
  }
  return { status: "ready", file: { format, name: exportFileName(plan.name, labels.fallbackName), content: text } };
}

export async function runExport(plan: ExportPlan, format: ExportFormat, labels: ExportLabels, control: ExportControl, deps: ExportDeps): Promise<ExportResult> {
  let saved: SavedExport | null = null;
  let shared = false;
  try {
    const prepared = await prepare(plan, format, labels, control, deps);
    if (prepared.status !== "ready") {
      return prepared;
    }
    saved = await deps.save(prepared.file);
    if (control.cancelled) {
      return { status: "cancelled" };
    }
    shared = await deps.share(saved.uri, format);
    return shared ? { status: "shared" } : { status: "unavailable" };
  } catch {
    return control.cancelled ? { status: "cancelled" } : { status: "error" };
  } finally {
    if (!shared) {
      saved?.discard();
    }
  }
}
