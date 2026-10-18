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

export type Engine = { convert: (tex: string, display: boolean) => Promise<string> };

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

function loadRange(name: string): Promise<void> {
  const range = RANGE_NAME.exec(name)?.[1];
  return range !== undefined && RANGES.has(range) ? Promise.resolve() : Promise.reject(new Error("font range not in the app"));
}

export function createEngine(): Engine {
  mathjax.asyncLoad = loadRange;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  return {
    convert: async (tex, display) => {
      const input = new TeX({
        packages: ["base", "ams"],
        formatError: (_jax: unknown, error: Error) => {
          throw error;
        },
      });
      const output = new SVG({ fontCache: "none", linebreaks: { inline: false } });
      const document = mathjax.document("", { InputJax: input, OutputJax: output });
      const node = await document.convertPromise(tex, { display });
      const children = adaptor.childNodes(node);
      if (children.length !== 1 || adaptor.kind(children[0]) !== "svg") {
        throw new Error("the drawing is not one picture");
      }
      return adaptor.innerHTML(node);
    },
  };
}
