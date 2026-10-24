import type { DrawnTex } from "@/pages/tex";
import type { Block, ExportDocument, ExportedPage, Part } from "./document";
import { escapeHtml } from "./text";

export type Drawings = ReadonlyMap<string, DrawnTex | null>;

const POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

const STYLE = [
  "@page { margin: 18mm }",
  "html, body { margin: 0; padding: 0 }",
  'body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.5; color: black; background: white }',
  ".page { break-after: page; page-break-after: always }",
  "section:last-of-type { break-after: auto; page-break-after: auto }",
  "h1 { font-size: 20pt; margin: 0 0 12pt }",
  "h2.section { font-size: 12pt; font-weight: normal; margin: 0 0 8pt; color: dimgray }",
  "p { margin: 0 0 4pt }",
  ".gap { height: 10pt }",
  ".display { margin: 8pt 0; text-align: center }",
  'code { font-family: "Courier New", monospace; font-size: 10pt }',
  "img { max-width: 100% }",
].join("\n");

export function formulaKey(tex: string, display: boolean): string {
  return `${display ? "display" : "inline"}:${tex}`;
}

function encodeSvg(svg: string): string {
  return encodeURIComponent(svg).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function measure(value: number): string {
  return String(Number(value.toFixed(3)));
}

function image(drawn: DrawnTex | null | undefined): string | null {
  if (drawn === null || drawn === undefined) {
    return null;
  }
  const { width, height, shift } = drawn;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(shift) || width <= 0 || height <= 0) {
    return null;
  }
  const style = `width: ${measure(width)}ex; height: ${measure(height)}ex; vertical-align: ${measure(shift)}ex`;
  return `<img alt="" src="data:image/svg+xml;utf8,${encodeSvg(drawn.svg)}" style="${style}">`;
}

function formula(tex: string, source: string, display: boolean, drawings: Drawings): string {
  return image(drawings.get(formulaKey(tex, display))) ?? `<code>${escapeHtml(source)}</code>`;
}

function partHtml(part: Part, drawings: Drawings): string {
  return part.kind === "text" ? escapeHtml(part.text) : formula(part.tex, part.source, false, drawings);
}

function blockHtml(block: Block, drawings: Drawings): string {
  if (block.kind === "gap") {
    return '<div class="gap"></div>';
  }
  if (block.kind === "display") {
    return `<div class="display">${formula(block.tex, block.source, true, drawings)}</div>`;
  }
  return `<p>${block.parts.map((part) => partHtml(part, drawings)).join("")}</p>`;
}

function pageHtml(page: ExportedPage, heading: string | null, drawings: Drawings): string {
  const kicker = heading === null ? "" : `<h2 class="section">${escapeHtml(heading)}</h2>`;
  return `<section class="page">${kicker}<h1>${escapeHtml(page.title)}</h1>${page.blocks.map((block) => blockHtml(block, drawings)).join("\n")}</section>`;
}

export function toHtml(document: ExportDocument, drawings: Drawings, language: "en" | "fr"): string {
  const lang = language === "fr" ? "fr" : "en";
  const sections = document.sections.flatMap((section) =>
    section.pages.map((page, index) => pageHtml(page, index === 0 ? section.heading : null, drawings)),
  );
  return [
    "<!doctype html>",
    `<html lang="${lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    `<title>${escapeHtml(document.name)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    ...sections,
    "</body>",
    "</html>",
  ].join("\n");
}
