import type { Block, ExportDocument } from "@/export/document";
import { toMarkdown } from "@/export/markdown";

function single(blocks: Block[]): ExportDocument {
  return { kind: "page", name: "N", sections: [{ heading: null, pages: [{ id: "p", title: "T", blocks }] }] };
}

const withFormula = (tex: string, source: string) =>
  single([{ kind: "line", parts: [{ kind: "text", text: "avant " }, { kind: "formula", tex, source }, { kind: "text", text: " après" }] }]);

describe("formulas in Markdown", () => {
  test.each([
    ["an image", "![p](http://evil.example/p.png)", "$![p](http://evil.example/p.png)$"],
    ["a link", "[x](http://evil.example)", "$[x](http://evil.example)$"],
    ["a bare address", "http://evil.example", "$http://evil.example$"],
    ["a www address", "www.evil.example", "$www.evil.example$"],
    ["an at sign", "a@b.co", "$a@b.co$"],
    ["a heading mark", "# x", "$# x$"],
    ["a percent sign", "x % y", "$x % y$"],
    ["a quote", 'x "y"', '$x "y"$'],
    ["a tilde", "x ~ y", "$x ~ y$"],
    ["a trailing backslash", "x\\", "$x\\$"],
  ])("writes %s as escaped text, never as LaTeX", (_, tex, source) => {
    const markdown = toMarkdown(withFormula(tex, source)).split("\n").slice(2).join("\n");
    expect(markdown).not.toContain(`$${tex}$`);
    expect(markdown).not.toMatch(/(^|[^\\])\]\(/m);
    expect(markdown).not.toMatch(/(^|[^\\])(@|#)/m);
    expect(markdown).not.toMatch(/(^|[^\\])(:\/\/|www\.)/m);
  });

  test("the formulas after a refused one stay paired", () => {
    const built = single([
      {
        kind: "line",
        parts: [
          { kind: "formula", tex: "x\\", source: "\\(x\\\\\\)" },
          { kind: "text", text: " et " },
          { kind: "formula", tex: "a", source: "$a$" },
          { kind: "text", text: " puis [c](http://evil.example) " },
          { kind: "formula", tex: "b", source: "$b$" },
        ],
      },
    ]);
    const line = toMarkdown(built).split("\n")[2];
    expect(line).toContain("$a$");
    expect(line).toContain("$b$");
    expect(line).toContain("\\[c\\]");
    expect((line.match(/(^|[^\\])\$/g) ?? []).length).toBe(4);
  });

  test("a display formula with a heading or a list on its lines is written as escaped text on one line", () => {
    const markdown = toMarkdown(single([{ kind: "display", tex: "a\n# Heading\n- item\n", source: "\\[a\n# Heading\n- item\n\\]" }]));
    expect(markdown).toBe("# T\n\n\\\\\\[a \\# Heading - item \\\\\\]\n");
  });

  test("a display formula on several lines of plain LaTeX is written on one line", () => {
    expect(toMarkdown(single([{ kind: "display", tex: "a +\n  b", source: "\\[a + b\\]" }]))).toBe("# T\n\n$$\na + b\n$$\n");
  });

  test("a lone carriage return in a line never starts a heading or a list", () => {
    const markdown = toMarkdown(single([{ kind: "line", parts: [{ kind: "text", text: "abc\rdef\r---\r- item" }] }]));
    expect(markdown).toBe("# T\n\nabc def --- - item\n");
    expect(markdown).not.toMatch(/\r/);
  });
});
