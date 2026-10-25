export const MAX_RENDER_INPUT = 20_000;

export const MAX_RENDER_OUTPUT = 60_000;

export type Fidelity = { ok: true } | { ok: false; reason: "output_too_long" | "refused_mark" | "text_changed" };

const UNDERLINE = /<\/?u>/g;
const LINE_MARK = /^ {0,4}(?:#{1,3}|[-*+]|\d{1,3}\.)[ \t]+/;
const BOLD = /\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*/g;
const STAR = /(?<![\p{L}\p{N}*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\p{L}\p{N}*])/gu;
const UNDERSCORE = /(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu;
const REFUSED = ["<", ">", "[", "`", "|", "\\"];

export function renderInput(text: string): string {
  return text.replace(UNDERLINE, "");
}

export async function fingerprint(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bare(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LINE_MARK, "").replace(BOLD, "$1").replace(STAR, "$1").replace(UNDERSCORE, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function occurrences(text: string, mark: string): number {
  return text.split(mark).length - 1;
}

export function checkFidelity(input: string, output: string): Fidelity {
  if (output.length > MAX_RENDER_OUTPUT) return { ok: false, reason: "output_too_long" };
  if (bare(output) === bare(input)) return { ok: true };
  const added = REFUSED.some((mark) => occurrences(output, mark) > occurrences(input, mark));
  return { ok: false, reason: added ? "refused_mark" : "text_changed" };
}
