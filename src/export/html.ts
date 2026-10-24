import type { DrawnTex } from "@/pages/tex";
import type { Block, ExportDocument, ExportedPage, Part } from "./document";
import { escapeHtml } from "./text";

export type Drawings = ReadonlyMap<string, DrawnTex | null>;

export const MAX_EMBEDDED_CHARS = 8_000_000;

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

function encodeSvg(svg: string): string | null {
  try {
    return encodeURIComponent(svg).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return null;
  }
}

function measure(value: number): string {
  return String(Number(value.toFixed(3)));
}

type Embedder = (drawn: DrawnTex | null | undefined) => string | null;

function makeEmbedder(): Embedder {
  const encoded = new Map<string, string | null>();
  let total = 0;
  return (drawn) => {
    if (drawn === null || drawn === undefined) {
      return null;
    }
    const { width, height, shift } = drawn;
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(shift) || width <= 0 || height <= 0) {
      return null;
    }
    let data = encoded.get(drawn.svg);
    if (data === undefined) {
      data = encodeSvg(drawn.svg);
      encoded.set(drawn.svg, data);
    }
    if (data === null) {
      return null;
    }
    total += data.length;
    if (total > MAX_EMBEDDED_CHARS) {
      return null;
    }
    const style = `width: ${measure(width)}ex; height: ${measure(height)}ex; vertical-align: ${measure(shift)}ex`;
    return `<img alt="" src="data:image/svg+xml;utf8,${data}" style="${style}">`;
  };
}

function formula(tex: string, source: string, display: boolean, drawings: Drawings, embed: Embedder): string {
  return embed(drawings.get(formulaKey(tex, display))) ?? `<code>${escapeHtml(source)}</code>`;
}

function partHtml(part: Part, drawings: Drawings, embed: Embedder): string {
  return part.kind === "text" ? escapeHtml(part.text) : formula(part.tex, part.source, false, drawings, embed);
}

function blockHtml(block: Block, drawings: Drawings, embed: Embedder): string {
  if (block.kind === "gap") {
    return '<div class="gap"></div>';
  }
  if (block.kind === "display") {
    return `<div class="display">${formula(block.tex, block.source, true, drawings, embed)}</div>`;
  }
  return `<p>${block.parts.map((part) => partHtml(part, drawings, embed)).join("")}</p>`;
}

function pageHtml(page: ExportedPage, heading: string | null, drawings: Drawings, embed: Embedder): string {
  const kicker = heading === null ? "" : `<h2 class="section">${escapeHtml(heading)}</h2>`;
  return `<section class="page">${kicker}<h1>${escapeHtml(page.title)}</h1>${page.blocks.map((block) => blockHtml(block, drawings, embed)).join("\n")}</section>`;
}

export function toHtml(document: ExportDocument, drawings: Drawings, language: "en" | "fr"): string {
  const lang = language === "fr" ? "fr" : "en";
  const embed = makeEmbedder();
  const sections = document.sections.flatMap((section) =>
    section.pages.map((page, index) => pageHtml(page, index === 0 ? section.heading : null, drawings, embed)),
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
