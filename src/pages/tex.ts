import type { Engine } from "./mathjax-engine";

export type DrawnTex = { svg: string; width: number; height: number; shift: number };

export const MAX_TEX_LENGTH = 2_000;
export const MAX_SVG_LENGTH = 512 * 1024;
export const MAX_WIDTH_EX = 300;
export const MAX_HEIGHT_EX = 120;
export const MAX_DEPTH = 20;
export const MAX_REPEAT = 20;
const CACHE_SIZE = 50;

const BACKSLASH = String.fromCharCode(92);
const REFUSED_COMMANDS = ["DeclareMathOperator", "mmlToken", "pmb", "newcolumntype", "label", "tag", "ref", "eqref"];
const COMMAND = /\\([A-Za-z]+)/g;
const REPEAT = /\*\s*\{\s*([^}]*)\}/g;
const ALIGNAT = /\\begin\{\s*[a-z]*align(?:ed)?at\*?\s*\}\s*\{\s*([^}]*)\}/g;
const SIZE = /^-?\d+(?:\.\d+)?ex$/;
const UNSAFE = /<a[\s>]|<image[\s>]|href|url\(/i;

let engine: Engine | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, DrawnTex | null>();
const pending = new Map<string, Promise<DrawnTex | null>>();

function loadEngine(): Engine {
  const { createEngine } = require("./mathjax-engine") as typeof import("./mathjax-engine");
  return createEngine();
}

function word(tex: string, at: number, name: string): boolean {
  return tex.startsWith(name, at) && !/[A-Za-z]/.test(tex[at + name.length] ?? "");
}

export function depth(tex: string): number {
  let deepest = 0;
  let current = 0;
  for (let index = 0; index < tex.length; index += 1) {
    const char = tex[index];
    if (char === BACKSLASH) {
      const next = index + 1;
      const environment = tex.startsWith("begin{", next) || tex.startsWith("end{", next);
      if (word(tex, next, "left") || tex.startsWith("begin{", next)) {
        current += 1;
      } else if (word(tex, next, "right") || tex.startsWith("end{", next)) {
        current = Math.max(0, current - 1);
      }
      const close = environment ? tex.indexOf("}", next) : -1;
      index = close === -1 ? index + 1 : close;
    } else if (char === "{") {
      current += 1;
    } else if (char === "}") {
      current = Math.max(0, current - 1);
    }
    deepest = Math.max(deepest, current);
  }
  return deepest;
}

function repeatsWithinBound(tex: string, pattern: RegExp): boolean {
  for (const found of tex.matchAll(pattern)) {
    const count = found[1].trim();
    if (!/^\d{1,3}$/.test(count) || Number(count) > MAX_REPEAT) {
      return false;
    }
  }
  return true;
}

export function acceptable(tex: string): boolean {
  if (tex.trim() === "" || tex.length > MAX_TEX_LENGTH) {
    return false;
  }
  for (const found of tex.matchAll(COMMAND)) {
    if (REFUSED_COMMANDS.includes(found[1])) {
      return false;
    }
  }
  if (!repeatsWithinBound(tex, REPEAT) || !repeatsWithinBound(tex, ALIGNAT)) {
    return false;
  }
  return depth(tex) <= MAX_DEPTH;
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
  if (width === null || height === null || width <= 0 || height <= 0 || width > MAX_WIDTH_EX || height > MAX_HEIGHT_EX) {
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

async function draw(tex: string, display: boolean): Promise<DrawnTex | null> {
  try {
    engine ??= loadEngine();
    return checkedSvg(await engine.convert(tex, display));
  } catch {
    return null;
  }
}

export function renderTex(tex: string, display: boolean): Promise<DrawnTex | null> {
  const key = keyOf(tex, display);
  const known = cache.get(key);
  if (known !== undefined) {
    return Promise.resolve(known);
  }
  if (!acceptable(tex)) {
    return Promise.resolve(remember(key, null));
  }
  const waiting = pending.get(key);
  if (waiting !== undefined) {
    return waiting;
  }
  const result = queue.then(() => draw(tex, display)).then((value) => {
    pending.delete(key);
    return remember(key, value);
  });
  queue = result;
  pending.set(key, result);
  return result;
}
