import type { Engine } from "./mathjax-engine";

export type DrawnTex = { svg: string; width: number; height: number; shift: number };

export const MAX_TEX_LENGTH = 2_000;
export const MAX_SVG_LENGTH = 512 * 1024;
export const MAX_WIDTH_EX = 300;
export const MAX_HEIGHT_EX = 120;
export const MAX_AREA_EX = 4_000;
export const MAX_ELEMENTS = 3_000;
export const MAX_COLUMNS = 20;
export const MAX_FORMULAS_PER_PAGE = 100;
export const MAX_DEPTH = 20;
const CACHE_SIZE = 50;

const BACKSLASH = String.fromCharCode(92);
const REFUSED_COMMANDS = [
  "DeclareMathOperator",
  "mmlToken",
  "pmb",
  "newcolumntype",
  "label",
  "tag",
  "ref",
  "eqref",
  "hsize",
  "vbox",
  "vtop",
  "vcenter",
  "parbox",
];
const ENVIRONMENTS = new Set([
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "aligned",
  "align",
  "align*",
  "gathered",
  "gather",
  "gather*",
  "equation",
  "equation*",
  "split",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "array",
]);
const COMMAND = /\\([A-Za-z]+)/g;
const COMMENT = /(?:^|[^\\])(?:\\\\)*%/;
const BEGIN = /\\begin(?![A-Za-z])/g;
const BEGIN_NAME = /\\begin\s*\{\s*([A-Za-z]+\*?)\s*\}/g;
const ARRAY_TEMPLATE = /^\s*(?:\[[tcb]?\]\s*)?\{([^}]*)\}/;
const PLAIN_TEMPLATE = new RegExp(`^\\s*\\|?(?:\\s*[lcr]\\s*\\|?){1,${MAX_COLUMNS}}\\s*$`);
const SIZE = /^-?\d+(?:\.\d+)?ex$/;
const UNSAFE = /<a[\s>]|<image[\s>]|href|url\(/i;

let engine: Engine | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, DrawnTex | null>();
const pending = new Map<string, Promise<DrawnTex | null | undefined>>();
const wanted = new Map<string, number>();

function loadEngine(): Engine {
  const { createEngine } = require("./mathjax-engine") as typeof import("./mathjax-engine");
  return createEngine();
}

function word(tex: string, at: number, name: string): boolean {
  return tex.startsWith(name, at) && !/[A-Za-z]/.test(tex[at + name.length] ?? "");
}

function opens(tex: string, at: number, name: string): number {
  if (!word(tex, at, name)) {
    return -1;
  }
  let next = at + name.length;
  while (/\s/.test(tex[next] ?? "")) {
    next += 1;
  }
  return tex[next] === "{" ? tex.indexOf("}", next) : -1;
}

export function depth(tex: string): number {
  const open: ("brace" | "left" | "environment")[] = [];
  let deepest = 0;
  for (let index = 0; index < tex.length; index += 1) {
    const char = tex[index];
    if (char === BACKSLASH) {
      const next = index + 1;
      const begin = opens(tex, next, "begin");
      const end = opens(tex, next, "end");
      if (begin !== -1) {
        open.push("environment");
        index = begin;
      } else if (end !== -1) {
        if (open[open.length - 1] === "environment") {
          open.pop();
        }
        index = end;
      } else if (word(tex, next, "left")) {
        open.push("left");
        index = next + 3;
      } else if (word(tex, next, "right")) {
        if (open[open.length - 1] === "left") {
          open.pop();
        }
        index = next + 4;
      } else {
        index += 1;
      }
    } else if (char === "{") {
      open.push("brace");
    } else if (char === "}") {
      const brace = open.lastIndexOf("brace");
      if (brace !== -1) {
        open.length = brace;
      }
    }
    deepest = Math.max(deepest, open.length);
  }
  return deepest;
}

function environmentsAllowed(tex: string): boolean {
  const begins = [...tex.matchAll(BEGIN)].length;
  const named = [...tex.matchAll(BEGIN_NAME)];
  if (named.length !== begins) {
    return false;
  }
  return named.every((found) => {
    const name = found[1];
    if (!ENVIRONMENTS.has(name)) {
      return false;
    }
    if (name !== "array") {
      return true;
    }
    const template = ARRAY_TEMPLATE.exec(tex.slice((found.index ?? 0) + found[0].length));
    return template !== null && PLAIN_TEMPLATE.test(template[1]);
  });
}

export function acceptable(tex: string): boolean {
  if (tex.trim() === "" || tex.length > MAX_TEX_LENGTH || COMMENT.test(tex)) {
    return false;
  }
  for (const found of tex.matchAll(COMMAND)) {
    if (REFUSED_COMMANDS.includes(found[1])) {
      return false;
    }
  }
  return environmentsAllowed(tex) && depth(tex) <= MAX_DEPTH;
}

function size(value: string | undefined): number | null {
  return value !== undefined && SIZE.test(value) ? Number.parseFloat(value) : null;
}

export function checkedSvg(svg: string): DrawnTex | null {
  if (!svg.startsWith("<svg") || svg.length > MAX_SVG_LENGTH || UNSAFE.test(svg) || svg.includes("data-mjx-error")) {
    return null;
  }
  const width = size(/^<svg[^>]*\swidth="([^"]+)"/.exec(svg)?.[1]);
  const height = size(/^<svg[^>]*\sheight="([^"]+)"/.exec(svg)?.[1]);
  const shift = /^<svg[^>]*\sstyle="vertical-align:\s*(-?\d+(?:\.\d+)?)ex/.exec(svg)?.[1];
  if (width === null || height === null || width <= 0 || height <= 0 || width > MAX_WIDTH_EX || height > MAX_HEIGHT_EX || width * height > MAX_AREA_EX) {
    return null;
  }
  if ((svg.match(/</g) ?? []).length > MAX_ELEMENTS) {
    return null;
  }
  return { svg, width, height, shift: shift === undefined ? 0 : Number.parseFloat(shift) };
}

function keyOf(tex: string, display: boolean): string {
  return `${display ? "display" : "inline"}:${tex}`;
}

function remember(key: string, value: DrawnTex | null): DrawnTex | null {
  cache.delete(key);
  if (cache.size >= CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
  return value;
}

export function cachedTex(tex: string, display: boolean): DrawnTex | null | undefined {
  return cache.get(keyOf(tex, display));
}

function yieldToScreen(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function draw(key: string, tex: string, display: boolean): Promise<DrawnTex | null | undefined> {
  await yieldToScreen();
  if (!wanted.has(key)) {
    return undefined;
  }
  try {
    engine ??= loadEngine();
    return checkedSvg(await engine.convert(tex, display));
  } catch {
    return null;
  }
}

export function renderTex(tex: string, display: boolean): Promise<DrawnTex | null | undefined> {
  const key = keyOf(tex, display);
  const known = cache.get(key);
  if (known !== undefined) {
    return Promise.resolve(known);
  }
  if (!acceptable(tex)) {
    return Promise.resolve(remember(key, null));
  }
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  const waiting = pending.get(key);
  if (waiting !== undefined) {
    return waiting;
  }
  const result = queue
    .then(() => draw(key, tex, display))
    .then((value) => {
      pending.delete(key);
      wanted.delete(key);
      return value === undefined ? undefined : remember(key, value);
    });
  queue = result;
  pending.set(key, result);
  return result;
}

export function releaseTex(tex: string, display: boolean): void {
  const key = keyOf(tex, display);
  const count = wanted.get(key);
  if (count === undefined) {
    return;
  }
  if (count <= 1) {
    wanted.delete(key);
  } else {
    wanted.set(key, count - 1);
  }
}
