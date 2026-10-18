import "./mathjax-context";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js";
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";

export type DrawnTex = { svg: string; width: number; height: number; shift: number };

const RANGES = new Set([
  "accents",
  "arrows",
  "calligraphic",
  "double-struck",
  "fraktur",
  "latin",
  "latin-b",
  "latin-i",
  "marrows",
  "math",
  "mshapes",
  "script",
  "shapes",
  "symbols",
  "variants",
]);

const RANGE_NAME = /\/svg\/dynamic\/([a-z-]+)\.js$/;
const SIZE = /^-?\d+(?:\.\d+)?ex$/;
const LINK = /<a[\s>]|href/i;

type Engine = { convert: (tex: string, display: boolean) => Promise<string> };

let engine: Engine | null = null;

function loadRange(name: string): Promise<void> {
  const range = RANGE_NAME.exec(name)?.[1];
  return range !== undefined && RANGES.has(range) ? Promise.resolve() : Promise.reject(new Error("font range not in the app"));
}

function startEngine(): Engine {
  mathjax.asyncLoad = loadRange;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({
    packages: ["base", "ams"],
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
  const output = new SVG({ fontCache: "none" });
  const document = mathjax.document("", { InputJax: input, OutputJax: output });
  return {
    convert: async (tex, display) => {
      const node = await document.convertPromise(tex, { display });
      return adaptor.innerHTML(node);
    },
  };
}

function size(value: string | undefined): number | null {
  return value !== undefined && SIZE.test(value) ? Number.parseFloat(value) : null;
}

function measured(svg: string): DrawnTex | null {
  const width = size(/^<svg[^>]*\swidth="([^"]+)"/.exec(svg)?.[1]);
  const height = size(/^<svg[^>]*\sheight="([^"]+)"/.exec(svg)?.[1]);
  const shift = /^<svg[^>]*\sstyle="vertical-align:\s*(-?\d+(?:\.\d+)?)ex/.exec(svg)?.[1];
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { svg, width, height, shift: shift === undefined ? 0 : Number.parseFloat(shift) };
}

export async function renderTex(tex: string, display: boolean): Promise<DrawnTex | null> {
  if (tex.trim() === "") {
    return null;
  }
  try {
    engine ??= startEngine();
    const svg = await engine.convert(tex, display);
    if (!svg.startsWith("<svg") || LINK.test(svg) || svg.includes("data-mjx-error")) {
      return null;
    }
    return measured(svg);
  } catch {
    return null;
  }
}
