import type { ExportDocument, ExportedPage } from "@/export/document";
import { toMarkdown } from "@/export/markdown";

const line = (text: string) => ({ kind: "line" as const, parts: [{ kind: "text" as const, text }] });

function exported(title: string, blocks: ExportedPage["blocks"], id = title): ExportedPage {
  return { id, title, blocks };
}

function document(kind: ExportDocument["kind"], name: string, sections: ExportDocument["sections"]): ExportDocument {
  return { kind, name, sections };
}

describe("toMarkdown", () => {
  test("a page is a heading of level 1, then its lines", () => {
    const built = document("page", "Histoire", [{ heading: null, pages: [exported("Magellan", [line("Portugais"), line("Mort en 1521"), { kind: "gap" }, line("Fin")])] }]);
    expect(toMarkdown(built)).toBe("# Magellan\n\nPortugais  \nMort en 1521\n\nFin\n");
  });

  test("a chapter is a title of level 1 and its pages of level 2, separated", () => {
    const built = document("chapter", "Chapitre 1", [{ heading: null, pages: [exported("Deux", [line("b")]), exported("Un", [line("a")])] }]);
    expect(toMarkdown(built)).toBe("# Chapitre 1\n\n## Deux\n\nb\n\n## Un\n\na\n");
  });

  test("a notebook without chapters is a title of level 1 and its pages of level 2", () => {
    const built = document("notebook", "Carnet", [{ heading: null, pages: [exported("Un", [line("a")])] }]);
    expect(toMarkdown(built)).toBe("# Carnet\n\n## Un\n\na\n");
  });

  test("a notebook with chapters puts the pages under the headings of level 2 at level 3", () => {
    const built = document("notebook", "Carnet", [
      { heading: "Premier", pages: [exported("Un", [line("a")])] },
      { heading: "Hors chapitre", pages: [exported("Deux", [line("b")])] },
    ]);
    expect(toMarkdown(built)).toBe("# Carnet\n\n## Premier\n\n### Un\n\na\n\n## Hors chapitre\n\n### Deux\n\nb\n");
  });

  test("a page without lines is its heading alone", () => {
    const built = document("page", "N", [{ heading: null, pages: [exported("Seul", [])] }]);
    expect(toMarkdown(built)).toBe("# Seul\n");
  });

  test("a document with no section is empty", () => {
    expect(toMarkdown(document("notebook", "Carnet", []))).toBe("# Carnet\n");
  });

  test("escapes the text of every line, title and heading", () => {
    const built = document("notebook", "<b>Carnet</b>", [
      { heading: "*Chap*", pages: [exported("# <script>alert(1)</script>", [line("<img src=x onerror=alert(1)>"), line("- [x](javascript:alert(1))"), line("&lt;b&gt;")])] },
    ]);
    const markdown = toMarkdown(built);
    expect(markdown).toBe(
      "# \\<b\\>Carnet\\</b\\>\n\n## \\*Chap\\*\n\n### \\# \\<script\\>alert(1)\\</script\\>\n\n\\<img src=x onerror=alert(1)\\>  \n\\- \\[x\\](javascript:alert(1))  \n\\&lt;b\\&gt;\n",
    );
    expect(markdown).not.toMatch(/(^|[^\\])[<>]/m);
  });

  test("a title or heading on several lines stays on one", () => {
    const built = document("chapter", "A\nB", [{ heading: null, pages: [exported("T\r\nU", [])] }]);
    expect(toMarkdown(built)).toBe("# A B\n\n## T U\n");
  });

  test("keeps the LaTeX of a formula between dollar signs", () => {
    const built = document("page", "N", [
      {
        heading: null,
        pages: [
          exported("Suites", [
            { kind: "line", parts: [{ kind: "text", text: "Soit " }, { kind: "formula", tex: "u_n = 2n", source: "$u_n = 2n$" }, { kind: "text", text: " et *x*" }] },
            { kind: "display", tex: " \\sum_{k=0}^{n} k ", source: "\\[ \\sum_{k=0}^{n} k \\]" },
          ]),
        ],
      },
    ]);
    expect(toMarkdown(built)).toBe("# Suites\n\nSoit $u_n = 2n$ et \\*x\\*\n\n$$\n\\sum_{k=0}^{n} k\n$$\n");
  });

  test("writes the signs of a formula that Markdown would read as HTML as LaTeX commands", () => {
    const built = document("page", "N", [
      { heading: null, pages: [exported("T", [{ kind: "line", parts: [{ kind: "formula", tex: "a<b>c", source: "$a<b>c$" }] }])] },
    ]);
    const markdown = toMarkdown(built);
    expect(markdown).toBe("# T\n\n$a\\lt b\\gt c$\n");
  });

  test.each([
    ["a dollar sign", "a $ b", "$a $ b$"],
    ["a backtick", "a`b", "$a`b$"],
    ["a command that is refused", "\\newcolumntype{x}{c}", "$\\newcolumntype{x}{c}$"],
    ["an empty formula", "  ", "$  $"],
  ])("falls back to the escaped source for %s", (_, tex, source) => {
    const built = document("page", "N", [{ heading: null, pages: [exported("T", [{ kind: "line", parts: [{ kind: "formula", tex, source }] }])] }]);
    expect(toMarkdown(built)).toBe(`# T\n\n${source.replace(/[\\`*_[\]<>&~|$#]/g, (character) => `\\${character}`)}\n`);
  });

  test("a display formula that cannot be kept becomes an escaped paragraph", () => {
    const built = document("page", "N", [{ heading: null, pages: [exported("T", [{ kind: "display", tex: "a $ b", source: "$$a $ b$$" }])] }]);
    expect(toMarkdown(built)).toBe("# T\n\n\\$\\$a \\$ b\\$\\$\n");
  });

  test("a hostile text never opens a tag whatever the block", () => {
    const hostile = "<script>alert(1)</script></style><img src=x onerror=alert(1)>";
    const built = document("notebook", hostile, [
      {
        heading: hostile,
        pages: [
          exported(hostile, [
            line(hostile),
            { kind: "line", parts: [{ kind: "formula", tex: hostile, source: hostile }] },
            { kind: "display", tex: hostile, source: hostile },
          ]),
        ],
      },
    ]);
    expect(toMarkdown(built)).not.toMatch(/(^|[^\\])[<>]/m);
  });
});
