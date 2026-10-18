import { mathDocument, mathPieces, mathRows } from "@/pages/formulas";

const B = String.fromCharCode(92);

describe("mathPieces", () => {
  test("cuts text and inline formulas between single dollars", () => {
    expect(mathPieces("Soit $x^2 + 1$ une fonction")).toEqual([
      { kind: "text", text: "Soit " },
      { kind: "inline", tex: "x^2 + 1", source: "$x^2 + 1$" },
      { kind: "text", text: " une fonction" },
    ]);
  });

  test("cuts display formulas between double dollars, on several lines", () => {
    expect(mathPieces("Calcul :\n$$\nx = 2\n$$\nfin")).toEqual([
      { kind: "text", text: "Calcul :\n" },
      { kind: "display", tex: "\nx = 2\n", source: "$$\nx = 2\n$$" },
      { kind: "text", text: "\nfin" },
    ]);
  });

  test("cuts the bracket and parenthesis delimiters", () => {
    expect(mathPieces(`On a ${B}[ a = b ${B}] et ${B}( c ${B})`)).toEqual([
      { kind: "text", text: "On a " },
      { kind: "display", tex: " a = b ", source: `${B}[ a = b ${B}]` },
      { kind: "text", text: " et " },
      { kind: "inline", tex: " c ", source: `${B}( c ${B})` },
    ]);
  });

  test("keeps an environment whole as a display formula", () => {
    const source = `${B}begin{align}\na &= b ${B}${B}\nc &= d\n${B}end{align}`;
    expect(mathPieces(`Système :\n${source}\nfin`)).toEqual([
      { kind: "text", text: "Système :\n" },
      { kind: "display", tex: source, source },
      { kind: "text", text: "\nfin" },
    ]);
  });

  test("leaves prices, lone dollars, escaped dollars and unclosed delimiters as text", () => {
    for (const text of ["Prix : 5$ et 10$", "De $5 à $10", "5 $ seulement", `un ${B}$ et ${B}$`, "$x", "$$ x", `${B}[ a`, `${B}( b`, `${B}begin{align} a`, "$a\nb$"]) {
      expect(mathPieces(text)).toEqual([{ kind: "text", text }]);
    }
  });

  test("gives back the text exactly when the pieces are put together", () => {
    const text = `Titre\nSoit $f(x)$ et $$g$$ puis ${B}(h${B}) et ${B}[k${B}] et 5$ fin`;
    expect(
      mathPieces(text)
        .map((piece) => (piece.kind === "text" ? piece.text : piece.source))
        .join(""),
    ).toBe(text);
  });

  test("reads a long text with many lone dollars at once", () => {
    const started = Date.now();
    mathPieces("$a ".repeat(50_000) + `${B}( `.repeat(50_000) + "$$ ".repeat(50_000));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("mathRows", () => {
  test("puts each line of text, with its inline formulas, on its own row, and each display formula on its own", () => {
    expect(mathRows("Soit $x$ réel\net $y$ aussi\n$$z$$\n\nfin")).toEqual([
      { kind: "line", parts: [{ kind: "text", text: "Soit " }, { kind: "inline", tex: "x", source: "$x$" }, { kind: "text", text: " réel" }] },
      { kind: "line", parts: [{ kind: "text", text: "et " }, { kind: "inline", tex: "y", source: "$y$" }, { kind: "text", text: " aussi" }] },
      { kind: "display", tex: "z", source: "$$z$$" },
      { kind: "gap" },
      { kind: "line", parts: [{ kind: "text", text: "fin" }] },
    ]);
  });

  test("keeps no empty row at the start or the end, and one gap for several blank lines", () => {
    expect(mathRows("\n\na\n\n\n\nb\n\n")).toEqual([
      { kind: "line", parts: [{ kind: "text", text: "a" }] },
      { kind: "gap" },
      { kind: "line", parts: [{ kind: "text", text: "b" }] },
    ]);
  });
});

describe("mathDocument", () => {
  test("takes the first line as the title when no formula starts on it", () => {
    const page = mathDocument("\nChapitre 1\nSoit $x$.");
    expect(page.title).toBe("Chapitre 1");
    expect(page.rows).toEqual([{ kind: "line", parts: [{ kind: "text", text: "Soit " }, { kind: "inline", tex: "x", source: "$x$" }, { kind: "text", text: "." }] }]);
  });

  test.each([
    ["$$", "\nx = 2\n$$\nfin"],
    [`${B}[`, ` a ${B}]`],
    [`${B}begin{align} a &= b`, `\n${B}end{align}`],
    ["Soit $f(x)$", " sur R"],
  ])("gives no title when a formula starts on the first line: %j", (first, rest) => {
    const page = mathDocument(first + rest);
    expect(page.title).toBeNull();
    expect(page.rows.some((row) => row.kind === "display" || (row.kind === "line" && row.parts.some((part) => part.kind === "inline")))).toBe(true);
  });

  test("an empty page has no title and no row", () => {
    expect(mathDocument("\n  \n")).toEqual({ title: null, rows: [] });
  });
});

describe("dollars written inside a formula", () => {
  test("an escaped dollar stays inside the inline formula", () => {
    expect(mathPieces(`prix $a ${B}$ b$ fin`)).toEqual([
      { kind: "text", text: "prix " },
      { kind: "inline", tex: `a ${B}$ b`, source: `$a ${B}$ b$` },
      { kind: "text", text: " fin" },
    ]);
  });
});
