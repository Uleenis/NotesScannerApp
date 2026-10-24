import { acceptable } from "@/pages/tex";
import type { Block, ExportDocument, ExportedPage, Part } from "./document";
import { escapeLineStart, escapeMarkdownInline } from "./text";

const BARE_DOLLAR = /(?:^|[^\\])(?:\\\\)*\$/;
const BLANK_LINE = /\n\s*\n/;
const NEWLINES = /\s*[\r\n]+\s*/g;

function oneLine(text: string): string {
  return text.replace(NEWLINES, " ").trim();
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${escapeMarkdownInline(oneLine(text))}`;
}

function keptTex(tex: string): string | null {
  if (!acceptable(tex) || tex.includes("`") || BARE_DOLLAR.test(tex)) {
    return null;
  }
  return tex.trim().replace(/</g, "\\lt ").replace(/>/g, "\\gt ");
}

function sourceText(source: string): string {
  return escapeMarkdownInline(oneLine(source));
}

function inlineFormula(tex: string, source: string): string {
  const kept = tex.includes("\n") ? null : keptTex(tex);
  return kept === null ? sourceText(source) : `$${kept}$`;
}

function displayFormula(tex: string, source: string): string {
  const kept = BLANK_LINE.test(tex) ? null : keptTex(tex);
  return kept === null ? sourceText(source) : `$$\n${kept}\n$$`;
}

function partText(part: Part): string {
  return part.kind === "text" ? escapeMarkdownInline(part.text) : inlineFormula(part.tex, part.source);
}

function paragraphs(blocks: Block[]): string[] {
  const result: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) {
      result.push(lines.join("  \n"));
      lines = [];
    }
  };
  for (const block of blocks) {
    if (block.kind === "line") {
      const text = block.parts.map(partText).join("").trim();
      if (text !== "") {
        lines.push(escapeLineStart(text));
      }
    } else if (block.kind === "display") {
      flush();
      result.push(displayFormula(block.tex, block.source));
    } else {
      flush();
    }
  }
  flush();
  return result;
}

function pageSection(page: ExportedPage, level: number): string[] {
  return [heading(level, page.title), ...paragraphs(page.blocks)];
}

export function toMarkdown(document: ExportDocument): string {
  const pieces: string[] = [];
  const sections = document.sections;
  if (document.kind === "page") {
    sections.forEach((section) => section.pages.forEach((page) => pieces.push(...pageSection(page, 1))));
    return pieces.length === 0 ? `${heading(1, document.name)}\n` : `${pieces.join("\n\n")}\n`;
  }
  pieces.push(heading(1, document.name));
  const hasHeadings = sections.some((section) => section.heading !== null);
  for (const section of sections) {
    if (section.heading !== null) {
      pieces.push(heading(2, section.heading));
    }
    for (const page of section.pages) {
      pieces.push(...pageSection(page, hasHeadings ? 3 : 2));
    }
  }
  return `${pieces.join("\n\n")}\n`;
}
