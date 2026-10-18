import type { Engine } from "./mathjax-engine";

export type DrawnTex = { svg: string; width: number; height: number; shift: number };

export const MAX_TEX_LENGTH = 2_000;
export const MAX_SVG_LENGTH = 512 * 1024;
export const MAX_WIDTH_EX = 300;
export const MAX_HEIGHT_EX = 120;
export const MAX_DEPTH = 40;
const CACHE_SIZE = 200;

const BACKSLASH = String.fromCharCode(92);
const REFUSED_COMMANDS = ["DeclareMathOperator", "mmlToken"];
const SIZE = /^-?\d+(?:\.\d+)?ex$/;
const UNSAFE = /<a[\s>]|<image[\s>]|href|url\(/i;

let engine: Engine | null = null;
const cache = new Map<string, DrawnTex | null>();

function loadEngine(): Engine {
  const { createEngine } = require("./mathjax-engine") as typeof import("./mathjax-engine");
  return createEngine();
}

function depth(tex: string): number {
  let deepest = 0;
  let current = 0;
  for (let index = 0; index < tex.length; index += 1) {
    const char = tex[index];
    if (char === BACKSLASH) {
      if (tex.startsWith("left", index + 1)) {
        current += 1;
      } else if (tex.startsWith("right", index + 1)) {
        current -= 1;
      }
      index += 1;
    } else if (char === "{") {
      current += 1;
    } else if (char === "}") {
      current -= 1;
    }
    deepest = Math.max(deepest, current);
  }
  return deepest;
}

export function acceptable(tex: string): boolean {
  if (tex.trim() === "" || tex.length > MAX_TEX_LENGTH) {
    return false;
  }
  if (REFUSED_COMMANDS.some((command) => tex.includes(`${BACKSLASH}${command}`))) {
    return false;
  }
  return depth(tex) <= MAX_DEPTH;
}

function size(value: string | undefined): number | null {
  return value !== undefined && SIZE.test(value) ? Number.parseFloat(value) : null;
}

function measured(svg: string): DrawnTex | null {
  const width = size(/^<svg[^>]*\swidth="([^"]+)"/.exec(svg)?.[1]);
  const height = size(/^<svg[^>]*\sheight="([^"]+)"/.exec(svg)?.[1]);
  const shift = /^<svg[^>]*\sstyle="vertical-align:\s*(-?\d+(?:\.\d+)?)ex/.exec(svg)?.[1];
  if (width === null || height === null || width <= 0 || height <= 0 || width > MAX_WIDTH_EX || height > MAX_HEIGHT_EX) {
    return null;
  }
  return { svg, width, height, shift: shift === undefined ? 0 : Number.parseFloat(shift) };
}

function remember(key: string, value: DrawnTex | null): DrawnTex | null {
  if (cache.size >= CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
  return value;
}

export async function renderTex(tex: string, display: boolean): Promise<DrawnTex | null> {
  const key = `${display ? "display" : "inline"}:${tex}`;
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  if (!acceptable(tex)) {
    return remember(key, null);
  }
  try {
    engine ??= loadEngine();
    const svg = await engine.convert(tex, display);
    if (!svg.startsWith("<svg") || svg.indexOf("<svg", 1) !== -1 || svg.length > MAX_SVG_LENGTH || UNSAFE.test(svg) || svg.includes("data-mjx-error")) {
      return remember(key, null);
    }
    return remember(key, measured(svg));
  } catch {
    return remember(key, null);
  }
}
