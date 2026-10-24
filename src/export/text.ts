export const MAX_FILE_NAME_LENGTH = 80;
export const MAX_FILE_NAME_BYTES = 200;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const MARKDOWN_SPECIALS = /[\\`*_[\]<>&~|$#@]|:(?=\/\/)|(?<=\bwww)\./gi;
const LINE_BREAKS = new RegExp("[\r\n\u0085\u2028\u2029\v\f]+", "gu");
const LINE_MARKER = /^(?:([-+=])|(\d+)([.)]))/;
const NOT_IN_A_FILE_NAME = /[^\p{L}\p{N}\p{M}._-]+/gu;
const EDGE = /^[._-]+|[._-]+$/g;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);
}

export function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ").trim();
}

export function escapeMarkdownInline(text: string): string {
  return text.replace(LINE_BREAKS, " ").replace(MARKDOWN_SPECIALS, (character) => "\\" + character);
}

export function escapeLineStart(line: string): string {
  return line.replace(LINE_MARKER, (_, mark: string | undefined, digits: string | undefined, punctuation: string | undefined) =>
    mark !== undefined ? "\\" + mark : (digits ?? "") + "\\" + (punctuation ?? ""),
  );
}

export function escapeMarkdown(text: string): string {
  return escapeLineStart(escapeMarkdownInline(text.trim()));
}

function utf8Length(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

function cut(text: string): string {
  let bytes = 0;
  const kept: string[] = [];
  for (const character of text) {
    bytes += utf8Length(character);
    if (kept.length >= MAX_FILE_NAME_LENGTH || bytes > MAX_FILE_NAME_BYTES) {
      break;
    }
    kept.push(character);
  }
  return kept.join("");
}

export function exportFileName(name: string, fallback: string): string {
  const reduced = name.normalize("NFC").replace(NOT_IN_A_FILE_NAME, "-").replace(EDGE, "");
  const kept = cut(reduced).replace(EDGE, "");
  return kept === "" ? fallback : kept;
}
