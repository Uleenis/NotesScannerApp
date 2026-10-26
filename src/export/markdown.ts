import { acceptable } from "@/pages/tex";
import type { Block, ExportDocument, ExportedPage, Part } from "./document";
import { escapeLineStart, escapeMarkdownInline, oneLine } from "./text";

const TEX_ALPHABET = /^[\p{L}\p{N} \\{}^_=+\-*/().,|:;!?'<>&]*$/u;
const URL_START = /:\/|\bwww\./i;
const TRAILING_BACKSLASHES = /\\+$/;

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${escapeMarkdownInline(oneLine(text))}`;
}

function keptTex(tex: string): string | null {
  if (!acceptable(tex)) {
    return null;
  }
  const flat = tex.replace(/\s+/g, " ").trim();
  const trailing = TRAILING_BACKSLASHES.exec(flat)?.[0].length ?? 0;
  if (flat === "" || !TEX_ALPHABET.test(flat) || URL_START.test(flat) || trailing % 2 === 1) {
    return null;
  }
  return flat.replace(/</g, "\\lt ").replace(/>/g, "\\gt ");
}

function sourceText(source: string): string {
  return escapeMarkdownInline(oneLine(source));
}

function inlineFormula(tex: string, source: string): string {
  const kept = keptTex(tex);
  return kept === null ? sourceText(source) : `$${kept}$`;
}

function displayFormula(tex: string, source: string): string {
  const kept = keptTex(tex);
  return kept === null ? sourceText(source) : `$$\n${kept}\n$$`;
}

function emphasized(text: string, bold: boolean, italic: boolean): string {
  if (!bold && !italic) {
    return text;
  }
  const core = text.trim();
  if (core === "") {
    return text;
  }
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  const mark = bold && italic ? "***" : bold ? "**" : "*";
  return `${lead}${mark}${core}${mark}${trail}`;
}

function partText(part: Part): string {
  return part.kind === "text" ? emphasized(escapeMarkdownInline(part.text), part.bold === true, part.italic === true) : inlineFormula(part.tex, part.source);
}

function inline(parts: Part[]): string {
  return parts.map(partText).join("").trim();
}

function itemLine(block: Extract<Block, { kind: "item" }>): string {
  const mark = block.marker === null ? "-" : `${block.marker}.`;
  return `${block.depth === 1 ? "    " : ""}${mark} ${escapeLineStart(inline(block.parts))}`;
}

function paragraphs(blocks: Block[], level: number): string[] {
  const result: string[] = [];
  let lines: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (lines.length > 0) {
      result.push(lines.join("  \n"));
      lines = [];
    }
    if (items.length > 0) {
      result.push(items.join("\n"));
      items = [];
    }
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      result.push(`${"#".repeat(Math.min(6, level + block.level))} ${inline(block.parts)}`);
    } else if (block.kind === "item") {
      if (lines.length > 0) {
        flush();
      }
      items.push(itemLine(block));
    } else if (block.kind === "paragraph") {
      flush();
      const text = inline(block.parts);
      if (text !== "") {
        result.push(escapeLineStart(text));
      }
    } else if (block.kind === "line") {
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
  return [heading(level, page.title), ...paragraphs(page.blocks, level)];
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
