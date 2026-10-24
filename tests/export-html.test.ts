import type { ExportDocument, ExportedPage } from "@/export/document";
import { formulaKey, toHtml } from "@/export/html";
import type { DrawnTex } from "@/pages/tex";

const line = (text: string) => ({ kind: "line" as const, parts: [{ kind: "text" as const, text }] });

function exported(title: string, blocks: ExportedPage["blocks"]): ExportedPage {
  return { id: title, title, blocks };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4ex" height="2ex" style="vertical-align: -0.5ex;" viewBox="0 0 10 5"><path d="M0 0L10 5"/></svg>';
const drawn: DrawnTex = { svg: SVG, width: 4, height: 2, shift: -0.5 };

const ALLOWED_TAGS = new Set(["html", "head", "meta", "title", "style", "body", "section", "h1", "h2", "h3", "p", "div", "span", "code", "img"]);
const ALLOWED_ATTRIBUTES = new Set(["lang", "charset", "http-equiv", "content", "name", "class", "src", "alt", "style"]);

function tagsOf(html: string): { name: string; attributes: string[] }[] {
  const withoutStyle = html.replace(/<style>[\s\S]*?<\/style>/, "<style></style>");
  return [...withoutStyle.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"<>]*")?)*)\s*\/?>/g)].map((found) => ({
    name: found[1].toLowerCase(),
    attributes: [...found[2].matchAll(/\s+([a-zA-Z-]+)(?:="[^"<>]*")?/g)].map((attribute) => attribute[1].toLowerCase()),
  }));
}

function allTags(html: string): number {
  return (html.replace("<!doctype html>", "").replace(/<style>[\s\S]*?<\/style>/, "<style></style>").match(/</g) ?? []).length;
}

function sample(): ExportDocument {
  return {
    kind: "notebook",
    name: "Carnet",
    sections: [
      {
        heading: "Premier",
        pages: [
          exported("Suites", [
            line("Soit"),
            { kind: "gap" },
            { kind: "line", parts: [{ kind: "text", text: "avec " }, { kind: "formula", tex: "x^2", source: "$x^2$" }] },
            { kind: "display", tex: "y", source: "$$y$$" },
          ]),
          exported("Deux", [line("b")]),
        ],
      },
      { heading: null, pages: [exported("Trois", [line("c")])] },
    ],
  };
}

describe("toHtml", () => {
  const drawings: ReadonlyMap<string, DrawnTex | null> = new Map([
    [formulaKey("x^2", false), drawn],
    [formulaKey("y", true), drawn],
  ]);

  test("is a complete document with its language", () => {
    const html = toHtml(sample(), drawings, "fr");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(toHtml(sample(), drawings, "en")).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
  });

  test("forbids every script and every outside resource by a content security policy", () => {
    const html = toHtml(sample(), drawings, "en");
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">/);
    expect(html).not.toMatch(/<script|<link|<iframe|<object|<embed|<form|<base/i);
    expect(html).not.toMatch(/https?:|\/\/|url\(|@import|@font-face/i);
  });

  test("starts every page on a new sheet and writes the heading of a section once, before its first page", () => {
    const html = toHtml(sample(), drawings, "en");
    expect(html.match(/<section class="page">/g)).toHaveLength(3);
    expect(html.match(/<h2 class="section">/g)).toHaveLength(1);
    expect(html.indexOf("Premier")).toBeLessThan(html.indexOf("Suites"));
    expect(html.indexOf("Suites")).toBeLessThan(html.indexOf("Deux"));
    expect(html.indexOf("Deux")).toBeLessThan(html.indexOf("Trois"));
    expect(html).toContain("break-after: page");
  });

  test("writes the title, the lines and the gaps of a page", () => {
    const html = toHtml(sample(), drawings, "en");
    expect(html).toContain("<h1>Suites</h1>");
    expect(html).toContain("<p>Soit</p>");
    expect(html).toContain('<div class="gap"></div>');
  });

  test("draws a formula as an image that cannot run anything, sized from its numbers", () => {
    const html = toHtml(sample(), drawings, "en");
    const images = [...html.matchAll(/<img [^>]*>/g)].map((found) => found[0]);
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toMatch(/src="data:image\/svg\+xml;utf8,[A-Za-z0-9%._~-]*"/);
      expect(image).toContain('style="width: 4ex; height: 2ex; vertical-align: -0.5ex"');
    }
    expect(html).toContain('<div class="display"><img');
    expect(decodeURIComponent(/src="data:image\/svg\+xml;utf8,([^"]*)"/.exec(images[0])?.[1] ?? "")).toBe(SVG);
  });

  test("shows the source of a formula that was not drawn, escaped", () => {
    const html = toHtml(
      {
        kind: "page",
        name: "N",
        sections: [{ heading: null, pages: [exported("T", [{ kind: "line", parts: [{ kind: "formula", tex: "<b>", source: "$<b>$" }] }, { kind: "display", tex: "<i>", source: "$$<i>$$" }])] }],
      },
      new Map([[formulaKey("<b>", false), null]]),
      "en",
    );
    expect(html).toContain("<code>$&lt;b&gt;$</code>");
    expect(html).toContain("<code>$$&lt;i&gt;$$</code>");
    expect(html).not.toContain("<img");
  });

  test("keeps a drawing whose numbers are not finite out of the document", () => {
    const html = toHtml(
      { kind: "page", name: "N", sections: [{ heading: null, pages: [exported("T", [{ kind: "line", parts: [{ kind: "formula", tex: "x", source: "$x$" }] }])] }] },
      new Map([[formulaKey("x", false), { svg: SVG, width: Number.NaN, height: 2, shift: 0 }]]),
      "en",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("<code>$x$</code>");
  });

  test("a drawing that holds markup is an inert image, whatever it holds", () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>';
    const html = toHtml(
      { kind: "page", name: "N", sections: [{ heading: null, pages: [exported("T", [{ kind: "line", parts: [{ kind: "formula", tex: "x", source: "$x$" }] }])] }] },
      new Map([[formulaKey("x", false), { svg: evil, width: 1, height: 1, shift: 0 }]]),
      "en",
    );
    expect(html).not.toMatch(/<script|<foreignObject|onerror=alert/i);
    expect(tagsOf(html).every((tag) => ALLOWED_TAGS.has(tag.name))).toBe(true);
  });

  const hostile = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "</style><script>alert(1)</script>",
    '" onmouseover="alert(1)',
    "'><svg onload=alert(1)>",
    "&lt;script&gt;",
    "</title><script>alert(1)</script>",
  ];

  test.each(hostile)("shows %s as text everywhere and opens no tag", (text) => {
    const html = toHtml(
      {
        kind: "notebook",
        name: text,
        sections: [
          {
            heading: text,
            pages: [exported(text, [line(text), { kind: "line", parts: [{ kind: "formula", tex: text, source: text }] }, { kind: "display", tex: text, source: text }])],
          },
        ],
      },
      new Map(),
      "en",
    );
    const tags = tagsOf(html);
    expect(tags.every((tag) => ALLOWED_TAGS.has(tag.name))).toBe(true);
    expect(tags.every((tag) => tag.attributes.every((attribute) => ALLOWED_ATTRIBUTES.has(attribute)))).toBe(true);
    expect(allTags(html)).toBe(tags.length);
    expect(html).not.toMatch(/<script|<svg|<img src=x/i);
    expect(html).toContain(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  });

  test("the whole document only uses the allowed tags and attributes", () => {
    const html = toHtml(sample(), drawings, "fr");
    const tags = tagsOf(html);
    expect(allTags(html)).toBe(tags.length);
    expect(tags.every((tag) => ALLOWED_TAGS.has(tag.name))).toBe(true);
    expect(tags.every((tag) => tag.attributes.every((attribute) => ALLOWED_ATTRIBUTES.has(attribute)))).toBe(true);
  });

  test("the key of a formula tells inline from display", () => {
    expect(formulaKey("x", true)).not.toBe(formulaKey("x", false));
  });
});
