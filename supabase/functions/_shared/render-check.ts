export const MAX_RENDER_INPUT = 20_000;

export const MAX_RENDER_OUTPUT = 60_000;

export type Fidelity = { ok: true } | { ok: false; reason: "output_too_long" | "refused_mark" | "text_changed" };

const UNDERLINE = /<\/?u>/g;
const FORMULA = /\$\$[\s\S]+?\$\$|\$[^\s$](?:[^$\n]*[^\s$])?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\begin\{[A-Za-z*]+\}[\s\S]+?\\end\{[A-Za-z*]+\}/g;
const MASKED = /(\d+)/g;
const LINE_MARK = /^ {0,4}(?:(#{1,3})|([-*+])|(\d{1,3})\.)[ \t]+/;
const BOLD = /\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*/g;
const STAR = /(?<![\p{L}\p{N}*])\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*(?![\p{L}\p{N}*])/gu;
const UNDERSCORE = /(?<![\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu;
const REFUSED = ["<", ">", "[", "`", "|", "\\"];

export function renderInput(text: string): string {
  return text.replace(UNDERLINE, "");
}

export async function fingerprint(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Plain = { text: string; numbers: number[]; headings: number; bullets: number; emphasis: number };

function occurrences(text: string, mark: string): number {
  return text.split(mark).length - 1;
}

function emphasisMarks(text: string): number {
  return occurrences(text, "*") + occurrences(text, "_");
}

function plain(text: string): Plain {
  const formulas: string[] = [];
  const masked = text.replace(FORMULA, (found) => `${formulas.push(found) - 1}`);
  const numbers: number[] = [];
  let headings = 0;
  let bullets = 0;
  let emphasis = 0;
  const units: string[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length === 0) return;
    const rest = lines.join(" ");
    const bare = rest.replace(BOLD, "$1").replace(STAR, "$1").replace(UNDERSCORE, "$1");
    emphasis += emphasisMarks(rest) - emphasisMarks(bare);
    units.push(bare);
    lines = [];
  };
  for (const line of masked.split(/\r?\n/)) {
    if (line.trim() === "") {
      close();
      continue;
    }
    const mark = LINE_MARK.exec(line);
    if (mark === null) {
      lines.push(line);
      continue;
    }
    close();
    if (mark[1] !== undefined) headings += 1;
    if (mark[2] !== undefined) bullets += 1;
    if (mark[3] !== undefined) numbers.push(Number(mark[3]));
    lines.push(line.replace(LINE_MARK, ""));
    if (mark[1] !== undefined) close();
  }
  close();
  const stripped = units
    .join(" ")
    .replace(MASKED, (_, index: string) => formulas[Number(index)] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return { text: stripped, numbers, headings, bullets, emphasis };
}

function countsFromOne(numbers: readonly number[]): boolean {
  let expected = 1;
  for (const number of numbers) {
    if (number === 1) expected = 1;
    if (number !== expected) return false;
    expected += 1;
  }
  return true;
}

function sameNumbers(input: readonly number[], output: readonly number[]): boolean {
  if (input.length === output.length && input.every((number, at) => number === output[at])) return true;
  return input.length === 0 && countsFromOne(output);
}

export function checkFidelity(input: string, output: string): Fidelity {
  if (output.length > MAX_RENDER_OUTPUT) return { ok: false, reason: "output_too_long" };
  const wanted = plain(input);
  const given = plain(output);
  const keeps = given.headings >= wanted.headings && given.bullets >= wanted.bullets && given.emphasis >= wanted.emphasis;
  if (wanted.text === given.text && keeps && sameNumbers(wanted.numbers, given.numbers)) return { ok: true };
  const added = REFUSED.some((mark) => occurrences(output, mark) > occurrences(input, mark));
  return { ok: false, reason: added ? "refused_mark" : "text_changed" };
}
