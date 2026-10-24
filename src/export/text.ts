export const MAX_FILE_NAME_LENGTH = 80;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const MARKDOWN_SPECIALS = /[\\`*_[\]<>&~|$#]/g;
const LINE_MARKER = /^(?:([-+=])|(\d+)([.)]))/;
const NOT_IN_A_FILE_NAME = /[^\p{L}\p{N}._-]+/gu;
const EDGE = /^[._-]+|[._-]+$/g;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);
}

export function escapeMarkdownInline(text: string): string {
  return text.replace(MARKDOWN_SPECIALS, (character) => "\\" + character);
}

export function escapeLineStart(line: string): string {
  return line.replace(LINE_MARKER, (_, mark: string | undefined, digits: string | undefined, punctuation: string | undefined) =>
    mark !== undefined ? "\\" + mark : (digits ?? "") + "\\" + (punctuation ?? ""),
  );
}

export function escapeMarkdown(text: string): string {
  return escapeLineStart(escapeMarkdownInline(text.trim()));
}

export function exportFileName(name: string, fallback: string): string {
  const reduced = name.normalize("NFC").replace(NOT_IN_A_FILE_NAME, "-").replace(EDGE, "");
  const cut = Array.from(reduced).slice(0, MAX_FILE_NAME_LENGTH).join("").replace(EDGE, "");
  return cut === "" ? fallback : cut;
}
