import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import type { MathCheckStore } from "./ports.ts";

export const MAX_CHECKED_TEXT = 60_000;

const WORK_BUDGET = 3_000_000;

const SPACE = "\\t\\n\\v\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACES = new RegExp(`[${SPACE}]+`, "u");
const SPACES_ALL = new RegExp(`[${SPACE}]+`, "gu");
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu");
const BREAKS = "\n\r\v\f\u001c-\u001e\u0085\u2028\u2029";
const LINE_BREAKS = new RegExp(`\r\n|[${BREAKS}]`, "u");
const BRACED = /([\^_])\{([A-Za-z0-9-]{1,3})\}/gu;
const MARKUP = /[*_`#]/gu;
const TEX_FRAC = /\\d?frac\{([^{}]*)\}\{([^{}]*)\}/gu;
const TEX_ARG = /\\(?:sqrt|text|mathrm)\{([^{}]*)\}/gu;
const SUBSTANCE = /[\p{L}\p{N}\u2205]/u;

const REL = "=\u2260<>\u2264\u2265";
const OPEN = "([{";
const CLOSE = ")]}";
const CONT = new Set("+-./^;,*" + REL + CLOSE);

const TEX_WORD: readonly (readonly [string, string])[] = [
  ["\\varnothing", "\u2205"],
  ["\\emptyset", "\u2205"],
  ["\\cdot", "."],
  ["\\times", "."],
  ["\\div", "/"],
  ["\\left", ""],
  ["\\right", ""],
  ["\\quad", " "],
  ["\\qquad", " "],
  ["\\;", " "],
  ["\\,", " "],
  ["\\!", ""],
  ["\\ ", " "],
];

const SYMBOLS = new Map<string, string>([
  ...[..."\u2019\u2018\u00b4\u02bc"].map((ch): [string, string] => [ch, "'"]),
  ...[..."\u2010\u2011\u2012\u2013\u2014\u2015\u2212"].map((ch): [string, string] => [ch, "-"]),
  ...[..."\u00b7\u22c5\u2219\u00d7\u2217"].map((ch): [string, string] => [ch, "."]),
  ["\u00b2", "^2"],
  ["\u00b3", "^3"],
  ["\u00b9", "^1"],
  ["\u2070", "^0"],
  ["\u2074", "^4"],
  ["\u2075", "^5"],
  ["\u2076", "^6"],
  ["\u2077", "^7"],
  ["\u2078", "^8"],
  ["\u2079", "^9"],
  ...[..."\u00d8\u00f8\u03a6\u03d5"].map((ch): [string, string] => [ch, "\u2205"]),
  ["[", "{"],
  ["]", "}"],
]);

function delatex(text: string): string {
  if (!text.includes("\\") && !text.includes("$")) return text;
  let out = text.replaceAll("$", "");
  for (let pass = 0; pass < 3; pass++) out = out.replace(TEX_FRAC, "$1/$2");
  out = out.replace(TEX_ARG, (whole, inner: string) => (whole.startsWith("\\sqrt") ? `\u221a${inner}` : inner));
  for (const [source, target] of TEX_WORD) out = out.replaceAll(source, target);
  return out.replaceAll("\\{", "{").replaceAll("\\}", "}").replaceAll("\\", "");
}

function normalize(text: string): string {
  const folded = delatex(text).replace(BRACED, "$1$2").replace(MARKUP, "").normalize("NFC");
  let out = "";
  for (const ch of folded) out += SYMBOLS.get(ch) ?? ch;
  return out.replace(SPACES_ALL, "").toLowerCase();
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function hasRelation(chunk: string): boolean {
  for (const ch of REL) if (chunk.includes(ch)) return true;
  return false;
}

type Work = { left: number };

function complete(chunks: readonly string[], work: Work): boolean | null {
  const joined = chunks.join(" ");
  work.left -= joined.length;
  if (work.left < 0) return null;
  const text = normalize(joined);
  let cut = -1;
  for (const ch of REL) cut = Math.max(cut, text.lastIndexOf(ch));
  if (cut < 0) return false;
  const rhs = text.slice(cut + 1);
  return rhs.length > 0 && balanced(rhs);
}

function statementsOfLine(line: string, work: Work): string[] | null {
  const out: string[] = [];
  let current: string[] = [];
  let related = false;
  for (const chunk of line.split(SPACES).filter((part) => part.length > 0)) {
    if (current.length > 0 && related && !CONT.has(chunk[0])) {
      const done = complete(current, work);
      if (done === null) return null;
      if (done) {
        out.push(current.join(" "));
        current = [];
        related = false;
      }
    }
    current.push(chunk);
    related = related || hasRelation(chunk);
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

function keysOf(text: string, work: Work): string[] | null {
  const keys: string[] = [];
  for (const raw of text.split(LINE_BREAKS)) {
    const line = raw.replace(EDGES, "");
    if (line.length === 0) continue;
    const statements = statementsOfLine(line, work);
    if (statements === null) return null;
    for (const statement of statements) keys.push(normalize(statement));
  }
  return keys;
}

export function statementKeys(text: string): string[] {
  return keysOf(text, { left: Number.POSITIVE_INFINITY }) ?? [];
}

export type MathComparison = { onlyB1: number; onlyB2: number };

export function compareMath(b1: string, b2: string): MathComparison | null {
  if (b1.length > MAX_CHECKED_TEXT || b2.length > MAX_CHECKED_TEXT) return null;
  const work = { left: WORK_BUDGET };
  const first = keysOf(b1, work);
  const second = keysOf(b2, work);
  if (first === null || second === null) return null;
  const counts = new Map<string, number>();
  for (const key of first) if (SUBSTANCE.test(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  let onlyB2 = 0;
  for (const key of second) {
    if (!SUBSTANCE.test(key)) continue;
    const left = counts.get(key) ?? 0;
    if (left > 0) counts.set(key, left - 1);
    else onlyB2++;
  }
  let onlyB1 = 0;
  for (const left of counts.values()) onlyB1 += left;
  return { onlyB1, onlyB2 };
}

export async function checkMathPage(deps: { store: MathCheckStore; log: Logger }, userId: string, pageId: string): Promise<void> {
  try {
    const readings = await deps.store.mathCheckReadings(userId, pageId);
    if (!readings) return;
    const result = compareMath(readings.b1, readings.b2);
    if (!result) {
      deps.log.event("math_checked", { pageId, code: "skipped" });
      return;
    }
    if (result.onlyB1 + result.onlyB2 === 0) {
      deps.log.event("math_checked", { pageId, code: "complete" });
      return;
    }
    await deps.store.recordMathAlert(userId, pageId, result.onlyB1, result.onlyB2);
    deps.log.event("math_checked", { pageId, code: "incomplete" });
  } catch (error) {
    deps.log.event("unexpected_error", { errorName: errorName(error) });
  }
}
