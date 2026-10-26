import { MAX_RENDERING_LENGTH, parseRendering, type RichBlock, type RichSpan } from "@/render/markdown";

function spansText(spans: RichSpan[]): string {
  return spans.map((span) => (span.kind === "text" ? span.text : span.source)).join("");
}

function texts(blocks: RichBlock[]): string[] {
  return blocks.map((block) => (block.kind === "display" ? block.source : spansText(block.spans)));
}

function styled(spans: RichSpan[]): string[] {
  return spans.map((span) => (span.kind === "text" ? `${span.bold ? "b" : ""}${span.italic ? "i" : ""}:${span.text}` : `f:${span.tex}`));
}

const parse = (markdown: string): RichBlock[] => parseRendering(markdown) ?? [];

describe("parseRendering", () => {
  it("reads the three heading levels and leaves a deeper one as text", () => {
    const blocks = parse("# Un\n\n## Deux\n### Trois\n#### Quatre\nsuite");
    expect(blocks.map((block) => (block.kind === "heading" ? block.level : block.kind))).toEqual([1, 2, 3, "paragraph"]);
    expect(texts(blocks)).toEqual(["Un", "Deux", "Trois", "#### Quatre suite"]);
  });

  it("reads bullets and numbers with two levels", () => {
    const blocks = parse("- a\n  - b\n* c\n+ d\n1. e\n   2. f\n3. g");
    expect(blocks).toEqual([
      { kind: "item", depth: 0, marker: null, spans: [{ kind: "text", text: "a", bold: false, italic: false }] },
      { kind: "item", depth: 1, marker: null, spans: [{ kind: "text", text: "b", bold: false, italic: false }] },
      { kind: "item", depth: 0, marker: null, spans: [{ kind: "text", text: "c", bold: false, italic: false }] },
      { kind: "item", depth: 0, marker: null, spans: [{ kind: "text", text: "d", bold: false, italic: false }] },
      { kind: "item", depth: 0, marker: 1, spans: [{ kind: "text", text: "e", bold: false, italic: false }] },
      { kind: "item", depth: 1, marker: 2, spans: [{ kind: "text", text: "f", bold: false, italic: false }] },
      { kind: "item", depth: 0, marker: 3, spans: [{ kind: "text", text: "g", bold: false, italic: false }] },
    ]);
  });

  it("joins the lines of a paragraph and of a list item, and splits at a blank line", () => {
    const blocks = parse("un deux\ntrois\n\nquatre\n- cinq\nsix\n\n\nsept");
    expect(texts(blocks)).toEqual(["un deux trois", "quatre", "cinq six", "sept"]);
  });

  it("reads bold, italic and both", () => {
    const [block] = parse("a **gras** b *penché* c _aussi_ d ***tout*** e");
    expect(block.kind === "paragraph" && styled(block.spans)).toEqual([":a ", "b:gras", ": b ", "i:penché", ": c ", "i:aussi", ": d ", "bi:tout", ": e"]);
  });

  it("reads an emphasis spread over several lines", () => {
    const blocks = parse("Projet -> atteindre **les Indes\norientales, dont** iles\n\n- *un\ndeux* trois");
    expect(blocks[0].kind === "paragraph" && styled(blocks[0].spans)).toEqual([":Projet -> atteindre ", "b:les Indes orientales, dont", ": iles"]);
    expect(blocks[1].kind === "item" && styled(blocks[1].spans)).toEqual(["i:un deux", ": trois"]);
  });

  it("does not read an emphasis across a paragraph break or a heading", () => {
    expect(texts(parse("a **b\n\nc** d"))).toEqual(["a **b", "c** d"]);
    expect(texts(parse("# a **b\nc** d"))).toEqual(["a **b", "c** d"]);
  });

  it("keeps a mark that closes nothing, a star inside a word and a lone star as text", () => {
    expect(texts(parse("**ouvert sans fin"))).toEqual(["**ouvert sans fin"]);
    expect(texts(parse("2*3 et 4*5"))).toEqual(["2*3 et 4*5"]);
    expect(texts(parse("a * b"))).toEqual(["a * b"]);
    expect(texts(parse("snake_case_name"))).toEqual(["snake_case_name"]);
  });

  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "[lien](https://exemple.test)",
    "![image](https://exemple.test/a.png)",
    "https://exemple.test/a",
    "`code`",
    "| a | b |",
    "> citation",
    "&amp; &lt;",
    "---",
    "    indenté",
  ])("shows %s as the text it is", (hostile) => {
    const blocks = parse(hostile);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
    expect(texts(blocks)[0]).toBe(hostile.trim().replace(/\s+/g, " "));
  });

  it("keeps a tilde fence and a table as text lines of a paragraph", () => {
    expect(texts(parse("```js\nvar a;\n```"))).toEqual(["```js var a; ```"]);
    expect(texts(parse("| a | b |\n|---|---|\n| 1 | 2 |"))).toEqual(["| a | b | |---|---| | 1 | 2 |"]);
  });

  it("reads inline formulas as formulas and display formulas as blocks", () => {
    const blocks = parse("Soit $x^2 + 1$ avec **$y$ borné**.\n\n$$\int_0^1 x\,dx$$\n\nfin");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].kind === "paragraph" && styled(blocks[0].spans)).toEqual([":Soit ", "f:x^2 + 1", ": avec ", "f:y", "b: borné", ":."]);
    expect(blocks[1]).toEqual({ kind: "display", tex: "\int_0^1 x\,dx", source: "$$\int_0^1 x\,dx$$" });
    expect(texts(blocks)).toEqual(["Soit $x^2 + 1$ avec $y$ borné.", "$$\int_0^1 x\,dx$$", "fin"]);
  });

  it("does not read a mark inside a formula", () => {
    const [block] = parse("$x^*$ et $y^*$ et $a_1 * b_2$");
    expect(block.kind === "paragraph" && styled(block.spans).filter((span) => span.startsWith("f:"))).toEqual(["f:x^*", "f:y^*", "f:a_1 * b_2"]);
  });

  it("splits a paragraph around a display formula", () => {
    const blocks = parse("avant $$a+b$$ après");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "display", "paragraph"]);
    expect(texts(blocks)).toEqual(["avant", "$$a+b$$", "après"]);
  });

  it("treats the private marks of its own as text", () => {
    const blocks = parse("a\uE0000\uE001b $x$");
    expect(blocks[0].kind === "paragraph" && styled(blocks[0].spans).filter((span) => span.startsWith("f:"))).toEqual(["f:x"]);
    expect(texts(blocks)[0]).toContain("b ");
  });

  it("returns no block for an empty rendering and refuses one past the bound", () => {
    expect(parse("  \n\n ")).toEqual([]);
    expect(parseRendering("a".repeat(MAX_RENDERING_LENGTH + 1))).toBeNull();
    expect(parseRendering("a".repeat(MAX_RENDERING_LENGTH))).not.toBeNull();
  });

  it("only ever shows the words of the rendering", () => {
    const rendering = "# Titre **fort**\n\n- un *deux* _trois_\n  - quatre\n\n1. cinq\n\nsix <b>sept</b> [huit](x) `neuf`";
    const words = (text: string) => text.replace(/[#*_\-]+|\d\.|\s+/g, " ").trim().split(/\s+/);
    const shown = texts(parse(rendering)).join(" ");
    expect(words(shown)).toEqual(words(rendering));
  });
});
