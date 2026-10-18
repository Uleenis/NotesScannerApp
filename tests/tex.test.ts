import { createEngine } from "@/pages/mathjax-engine";
import { acceptable, cachedTex, checkedSvg, depth, MAX_AREA_EX, MAX_COLUMNS, MAX_DEPTH, MAX_ELEMENTS, MAX_TEX_LENGTH, releaseTex, renderTex } from "@/pages/tex";

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
    expect(acceptable("x" + "{}".repeat(MAX_TEX_LENGTH / 2))).toBe(false);
    expect(acceptable("x" + "{}".repeat(MAX_TEX_LENGTH / 2 - 1))).toBe(true);
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

describe("the second bounds of a formula", () => {
  test("counts left and right only as delimiters, and environments as depth", () => {
    expect(depth(`${B}rightarrow `.repeat(100) + "{".repeat(30) + "x" + "}".repeat(30))).toBe(30);
    expect(depth(`${B}leftarrow `.repeat(100) + "x")).toBe(0);
    expect(depth(`${B}left( x ${B}right)`)).toBe(1);
    expect(depth(`${B}begin{matrix}`.repeat(25) + "x" + `${B}end{matrix}`.repeat(25))).toBe(25);
    expect(acceptable(`${B}leftarrow `.repeat(41) + "x")).toBe(true);
    expect(acceptable(`${B}rightarrow `.repeat(100) + "{".repeat(MAX_DEPTH + 1) + "x" + "}".repeat(MAX_DEPTH + 1))).toBe(false);
  });

  test.each([
    [`${B}pmb{`.repeat(12) + "x" + "}".repeat(12)],
    [`${B}newcolumntype{c}{ccc}x`],
    [`${B}begin{alignedat}{10000000}x${B}end{alignedat}`],
    [`${B}begin {alignedat}{10000000}x${B}end{alignedat}`],
    [`${B}begin\t{alignedat}{10000000}x${B}end{alignedat}`],
    [`${B}begin{alignedat}[t]{10000000}x${B}end{alignedat}`],
    [`${B}begin{alignat*}{2}x${B}end{alignat*}`],
    [`${B}begin{array}{*{100000000}{c}}x${B}end{array}`],
    [`${B}begin{array}{*{3}{c}}x${B}end{array}`],
    [`${B}begin{array}{>{${B}displaystyle}c}x${B}end{array}`],
    [`${B}begin{array}{<{x}c}x${B}end{array}`],
    [`${B}begin{array}{@{}c}x${B}end{array}`],
    [`${B}begin{array}{!{x}c}x${B}end{array}`],
    [`${B}begin{array}{p{1em}}x${B}end{array}`],
    [`${B}begin{array}x${B}end{array}`],
    [`${B}begin{subarray}{c}x${B}end{subarray}`],
    [`${B}begin{unknown}x${B}end{unknown}`],
    [`${B}begin x`],
    [`${B}begin{matrix}x${B}end{matrix}${B}begin {9}`],
    [`x ${B}label{a}`],
    [`x ${B}tag{1}`],
    [`${B}ref{a}`],
  ])("refuses %s before drawing it", async (tex) => {
    const started = Date.now();
    expect(acceptable(tex)).toBe(false);
    expect(await renderTex(tex, true)).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test.each([
    [`${B}begin{array}{c|lr}a&b&c${B}end{array}`],
    [`${B}begin{array}[t]{cc}a&b${B}end{array}`],
    [`${B}begin {bmatrix}a${B}end{bmatrix}`],
    [`${B}begin{aligned}a&=b${B}${B}c&=d${B}end{aligned}`],
    [`${B}begin{equation*}x${B}end{equation*}`],
    [`${B}operatorname*{lim}_{x ${B}to 0} x`],
    [`${B}begin{multline}a+b${B}${B}+c${B}end{multline}`],
    [`${B}begin{flalign}a&=b${B}end{flalign}`],
    [`${B}begin{eqnarray}a&=&b${B}end{eqnarray}`],
    [`50${B}% + x`],
  ])("still draws %s, written with the common environments", async (tex) => {
    expect(acceptable(tex)).toBe(true);
    expect(await renderTex(tex, true)).not.toBeNull();
  });

  test("counts depth with what is open, so a closing word out of place resets nothing", () => {
    const lefts = `${B}left(`.repeat(MAX_DEPTH + 1);
    expect(depth(`${lefts}${B}text{${B}right)}x`)).toBeGreaterThan(MAX_DEPTH);
    expect(acceptable(`${lefts}${B}text{${B}right)}x`)).toBe(false);
    expect(depth(`${B}begin {matrix}`.repeat(25) + "x")).toBe(25);
    expect(depth(`{x${B}end{matrix}}{y}`)).toBe(1);
    expect(depth(`${B}left( {x ${B}right) } y`)).toBe(2);
    expect(depth(`${B}left( {x} ${B}right) {y}`)).toBe(2);
  });

  test.each([
    [`${"{".repeat(10)}%${"}".repeat(10)}\n`.repeat(4) + "x" + "}".repeat(40)],
    [`${B}left(%${B}right)\n`.repeat(30) + "x" + `${B}right)`.repeat(30)],
    ["x % y"],
    [`x ${B}${B}% y`],
  ])("refuses a comment, which would hide what it closes from the count: %j", (tex) => {
    expect(acceptable(tex)).toBe(false);
  });

  test.each([
    [`${B}begin{array}{${"|".repeat(300)}c}` + `x${B}${B}`.repeat(33) + `${B}end{array}`],
    [`${B}begin{array}{c||c}a&b${B}end{array}`],
    [`${B}begin{array}{${"c".repeat(MAX_COLUMNS + 1)}}x${B}end{array}`],
    [`${B}begin{array}{}x${B}end{array}`],
    [`${B}hsize=1em x`],
    [`${B}vbox{x}`],
    [`${B}vtop{x}`],
    [`${B}vcenter{x}`],
    [`${B}parbox{1em}{x}`],
  ])("refuses %j, whose drawing alone takes too long", (tex) => {
    expect(acceptable(tex)).toBe(false);
  });

  test.each([
    [`${"c    ".repeat(MAX_COLUMNS)}x`],
    [`${"c ".repeat(MAX_COLUMNS)}${" ".repeat(160)}x`],
    ["c ".repeat(MAX_COLUMNS + 1)],
  ])("refuses the spaced column template %j at once", (template) => {
    const started = Date.now();
    expect(acceptable(`${B}begin{array}{${template}}a${B}end{array}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });

  test("still draws an array with a rule between each column, up to the bound", async () => {
    expect(acceptable(`${B}begin{array}{ ${"c | ".repeat(MAX_COLUMNS)}}x${B}end{array}`)).toBe(true);
    expect(acceptable(`${B}begin{array}{|${"c|".repeat(MAX_COLUMNS)}}x${B}end{array}`)).toBe(true);
    expect(await renderTex(`${B}begin{array}{|c|c|c|}a&b&c${B}end{array}`, true)).not.toBeNull();
  });

  test("leaves the next formula as it would be drawn alone, whatever the previous one set", async () => {
    const engine = createEngine();
    const matrix = `${B}begin{pmatrix}1&2${B}${B}3&4${B}end{pmatrix}`;
    const alone = await engine.convert(matrix, true);
    await engine.convert(`${B}hsize=-5em x`, true).catch(() => "");
    expect(await engine.convert(matrix, true)).toBe(alone);
  });

  test("refuses a drawing too large in area or in pieces for the phone to hold", () => {
    const frame = (width: string, height: string, inside = "<g/>") => `<svg width="${width}" height="${height}">${inside}</svg>`;
    expect(checkedSvg(frame("299ex", "119ex"))).toBeNull();
    expect(checkedSvg(frame("100ex", `${MAX_AREA_EX / 100 + 1}ex`))).toBeNull();
    expect(checkedSvg(frame("100ex", `${MAX_AREA_EX / 100}ex`))).not.toBeNull();
    expect(checkedSvg(frame("10ex", "2ex", "<g/>".repeat(MAX_ELEMENTS)))).toBeNull();
    expect(checkedSvg(frame("10ex", "2ex", "<g/>".repeat(MAX_ELEMENTS - 2)))).not.toBeNull();
  });

  test("drops a drawing that nobody waits for any more, and keeps nothing of it", async () => {
    const tex = `${B}frac{q}{r} + ${B}sqrt{s}`;
    const asked = renderTex(tex, true);
    releaseTex(tex, true);
    expect(await asked).toBeUndefined();
    expect(cachedTex(tex, true)).toBeUndefined();
    expect(await renderTex(tex, true)).not.toBeNull();
  });

  test("still draws a formula when one of the two who asked for it leaves", async () => {
    const tex = `${B}frac{t}{u} + ${B}sqrt{v}`;
    const first = renderTex(tex, true);
    const second = renderTex(tex, true);
    releaseTex(tex, true);
    expect(await first).not.toBeUndefined();
    expect(await second).not.toBeNull();
    expect(cachedTex(tex, true)).not.toBeUndefined();
  });

  test("lets the screen draw between two formulas", async () => {
    const ticks: number[] = [];
    const timer = setInterval(() => ticks.push(Date.now()), 0);
    try {
      await Promise.all([1, 2, 3, 4].map((n) => renderTex(`${B}frac{${n}}{${n + 7}} + ${B}sqrt{${n}}`, true)));
    } finally {
      clearInterval(timer);
    }
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });

  test.each([
    [`${B}begin{pmatrix}1&2${B}${B}3&4${B}${B}5&6${B}end{pmatrix}`],
    [`${B}begin{cases}a${B}${B}b${B}${B}c${B}end{cases}`],
    [`${B}overline{abcdef}`],
    [`${B}underline{x}`],
    [`${B}left${B}{ ${B}begin{matrix}1${B}${B}2${B}${B}3${B}end{matrix} ${B}right.`],
  ])("draws %s, whose drawing holds stretched pieces", async (tex) => {
    expect(await renderTex(tex, true)).not.toBeNull();
  });

  test("refuses a drawing that holds a link, an image, a url or is too large, after drawing", () => {
    const frame = (inside: string, width = "10ex") => `<svg width="${width}" height="2ex" style="vertical-align: -0.5ex">${inside}</svg>`;
    expect(checkedSvg(frame("<g/>"))).not.toBeNull();
    expect(checkedSvg(frame('<a href="https://example.test"><g/></a>'))).toBeNull();
    expect(checkedSvg(frame('<image href="https://example.test/x.png"/>'))).toBeNull();
    expect(checkedSvg(frame('<rect fill="url(https://example.test/x)"/>'))).toBeNull();
    expect(checkedSvg(frame("<g/>", "301ex"))).toBeNull();
    expect(checkedSvg(frame("<g/>", "100%"))).toBeNull();
    expect(checkedSvg(frame("x".repeat(512 * 1024)))).toBeNull();
  });

  test("draws a formula asked twice at once only once, and reads it back from the cache", async () => {
    const tex = `${B}frac{a}{b} + ${B}sqrt{y}`;
    const [first, second] = await Promise.all([renderTex(tex, false), renderTex(tex, false)]);
    expect(first).toBe(second);
    expect(await renderTex(tex, false)).toBe(first);
  });
});
