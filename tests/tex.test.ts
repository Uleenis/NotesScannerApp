import { renderTex } from "@/pages/tex";

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
