import { MAX_DEPTH, MAX_TEX_LENGTH, renderTex } from "@/pages/tex";

const B = String.fromCharCode(92);

describe("renderTex", () => {
  test("draws a formula as SVG with its size in ex", async () => {
    const drawn = await renderTex(`${B}frac{1}{2} + x^2`, false);
    expect(drawn).not.toBeNull();
    expect(drawn?.svg.startsWith("<svg")).toBe(true);
    expect(drawn?.width).toBeGreaterThan(0);
    expect(drawn?.height).toBeGreaterThan(0);
  });

  test.each([
    `${B}mathbb{R} ${B}to ${B}mathbb{N}`,
    `${B}mathcal{C}`,
    `${B}mathfrak{g}`,
    "x² + é",
    `${B}int_0^1 f(x)${B},dx`,
    `${B}sum_{i=1}^n i`,
    `${B}lim_{x ${B}to 0} ${B}frac{${B}sin x}{x} = 1`,
    `${B}begin{pmatrix} 1 & 2 ${B}${B} 3 & 4 ${B}end{pmatrix}`,
    `${B}begin{align} a &= b ${B}end{align}`,
    `${B}alpha ${B}leq ${B}beta ${B}Rightarrow ${B}vec{u}`,
  ])("draws %s from the fonts in the app", async (tex) => {
    expect(await renderTex(tex, true)).not.toBeNull();
  });

  test.each([`${B}frac{1}{`, `${B}unknowncommand`, `${B}href{https://example.test}{x}`, `${B}url{https://example.test}`, `${B}class{x}{y}`, `${B}style{color:red}{y}`, `${B}require{html}`, ""])(
    "refuses %j, which is then shown raw",
    async (tex) => {
      expect(await renderTex(tex, false)).toBeNull();
    },
  );

  test("draws no link", async () => {
    const drawn = await renderTex(`${B}text{https://example.test} + ${B}mathrm{www}`, false);
    expect(drawn?.svg).not.toMatch(/<a[\s>]|href/);
  });

  test("calls nothing on the network", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network")));
    const opened = jest.fn();
    const scope = globalThis as { XMLHttpRequest?: unknown };
    const original = scope.XMLHttpRequest;
    scope.XMLHttpRequest = class {
      open = opened;
      send = opened;
    };
    try {
      await renderTex(`${B}mathbb{R} + ${B}mathcal{C} + ${B}mathfrak{g} + x²`, true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
    } finally {
      scope.XMLHttpRequest = original;
      fetchSpy.mockRestore();
    }
  });
});

describe("the bounds of a formula", () => {
  test("refuses a chain of operators that doubles at each step", async () => {
    let tex = `${B}DeclareMathOperator{${B}za}{xx}`;
    let last = "za";
    for (let level = 0; level < 14; level += 1) {
      const next = `${last}q`;
      tex += `${B}DeclareMathOperator{${B}${next}}{${B}${last}${B}${last}}`;
      last = next;
    }
    tex += `${B}${last}`;
    const started = Date.now();
    expect(await renderTex(tex, true)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  test.each([
    [`${B}rule{999999999em}{999999999em}`],
    [`${B}rule{1000em}{1ex}`],
    [`x${B}kern{9999em}x`],
    [`${B}hspace{100000000em}`],
  ])("refuses %s, drawn larger than a page", async (tex) => {
    expect(await renderTex(tex, true)).toBeNull();
  });

  test("refuses a formula longer than the bound, and one nested deeper than the bound", async () => {
    expect(await renderTex("x+".repeat(MAX_TEX_LENGTH), false)).toBeNull();
    expect(await renderTex(`${"{".repeat(MAX_DEPTH + 1)}x${"}".repeat(MAX_DEPTH + 1)}`, false)).toBeNull();
    expect(await renderTex(`${B}sqrt{`.repeat(MAX_DEPTH + 1) + "x" + "}".repeat(MAX_DEPTH + 1), false)).toBeNull();
  });

  test("refuses the MathML token command, which could set an image to fetch", async () => {
    expect(await renderTex(`${B}mmlToken{mglyph}[src="https://example.test/x.png"]{}`, false)).toBeNull();
    expect(await renderTex(`${B}mmlToken{mi}[href="https://example.test"]{x}`, false)).toBeNull();
  });

  test("still draws an ordinary formula with braces and sizes", async () => {
    expect(await renderTex(`${B}left( ${B}frac{a}{b} ${B}right)^{2} + ${B}quad ${B}sqrt{${B}sqrt{x}}`, true)).not.toBeNull();
  });
});

test("draws a long inline formula in one piece, measured whole", async () => {
  const drawn = await renderTex(`${"x + ".repeat(30)}x`, false);
  expect(drawn?.svg.indexOf("<svg", 1)).toBe(-1);
  expect(drawn?.width).toBeGreaterThan(100);
});
