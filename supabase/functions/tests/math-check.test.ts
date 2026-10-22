import { assert, assertEquals } from "jsr:@std/assert@1";
import { compareMath, MAX_CHECKED_TEXT, statementKeys } from "../_shared/math-check.ts";
import fixture from "./fixtures/math-units.json" with { type: "json" };

const PAGE = [
  "Chapitre 1",
  "a) 4x² - 8x = 0",
  "4x.(x - 4) = 0",
  "S = {0 ; 4}",
  "b) (x - 3)² = 0",
  "S = {3}",
].join("\n");

function without(text: string, line: string): string {
  return text.split("\n").filter((current) => current !== line).join("\n");
}

Deno.test("the same page twice has nothing missing from either pass [10]", () => {
  assertEquals(compareMath(PAGE, PAGE), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("spacing, case and the look of a symbol are not a difference [10]", () => {
  const compact = "Chapitre 1\na)4x²-8x=0\n4x·(x-4)=0\nS={0;4}\nb)(x-3)²=0\nS={3}";
  assertEquals(compareMath(PAGE, compact), { onlyB1: 0, onlyB2: 0 });
  assertEquals(compareMath(PAGE, PAGE.replace("S = {0 ; 4}", "S = [0 ; 4]").replace("4x²", "4x^2")), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("a page written in LaTeX says the same as the page written in plain symbols [10]", () => {
  const latex = [
    "Chapitre 1",
    "a) $4x^2 - 8x = 0$",
    "$4x \\cdot (x - 4) = 0$",
    "$S = \\{0 ; 4\\}$",
    "b) $(x - 3)^2 = 0$",
    "$S = \\{3\\}$",
  ].join("\n");
  assertEquals(compareMath(PAGE, latex), { onlyB1: 0, onlyB2: 0 });
  assertEquals(compareMath("S = \\varnothing\nx = \\frac{3}{2}\ny = \\sqrt{12}", "S = ∅\nx = 3/2\ny = √12"), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("two statements that share a line, or one split over two, are the same statements [10]", () => {
  const joined = "Chapitre 1\na) 4x² - 8x = 0\n4x.(x - 4) = 0 S = {0 ; 4}\nb) (x - 3)² = 0 S = {3}";
  assertEquals(compareMath(PAGE, joined), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("the order of the statements is not a difference, even by columns [10]", () => {
  const lines = PAGE.split("\n");
  const columns = [...lines.slice(3), ...lines.slice(0, 3)].join("\n");
  assertEquals(compareMath(PAGE, columns), { onlyB1: 0, onlyB2: 0 });
  assertEquals(compareMath(PAGE, [...lines].reverse().join("\n")), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("a statement one pass forgot is counted on the side of the pass that has it [10]", () => {
  assertEquals(compareMath(PAGE, without(PAGE, "S = {3}")), { onlyB1: 1, onlyB2: 0 });
  assertEquals(compareMath(without(PAGE, "S = {3}"), PAGE), { onlyB1: 0, onlyB2: 1 });
});

Deno.test("a statement one pass wrote otherwise counts on both sides [10]", () => {
  const changed = PAGE.replace("4x.(x - 4) = 0", "4x.(x - 2) = 0").replace("S = {0 ; 4}", "S = {0 ; 2}");
  assertEquals(compareMath(PAGE, changed), { onlyB1: 2, onlyB2: 2 });
});

Deno.test("a statement written twice by one pass only is a difference, counted once per copy [10]", () => {
  assertEquals(compareMath(PAGE, `${PAGE}\nS = {3}`), { onlyB1: 0, onlyB2: 1 });
  assertEquals(compareMath(`${PAGE}\nS = {3}\nS = {3}`, `${PAGE}\nS = {3}`), { onlyB1: 1, onlyB2: 0 });
});

Deno.test("a pass with no statement leaves every statement of the other missing [10]", () => {
  assertEquals(compareMath(PAGE, ""), { onlyB1: statementKeys(PAGE).length, onlyB2: 0 });
  assertEquals(compareMath("", ""), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("the statements are cut at a relation followed by a balanced operand [10]", () => {
  assertEquals(statementKeys("S = {0 ; 4} S = {1}"), ["s={0;4}", "s={1}"]);
  assertEquals(statementKeys("4x . (x - 4) = 0"), ["4x.(x-4)=0"]);
  assertEquals(statementKeys("a = (b + 1"), ["a=(b+1"]);
  assertEquals(statementKeys("\n  \n"), []);
});

Deno.test("a page too long to compare in a bounded time is not compared at all [10]", () => {
  const long = "x + 1 ".repeat(MAX_CHECKED_TEXT / 6 + 10);
  assertEquals(MAX_CHECKED_TEXT % 6, 0);
  assert(long.length > MAX_CHECKED_TEXT);
  assertEquals(compareMath(long, PAGE), null);
  assertEquals(compareMath(PAGE, long), null);
});

Deno.test("a long line with no relation is read at once [10]", () => {
  const line = "x + 1 ".repeat(MAX_CHECKED_TEXT / 6 - 10);
  const started = performance.now();
  assertEquals(compareMath(line, line), { onlyB1: 0, onlyB2: 0 });
  assert(performance.now() - started < 2000);
});

Deno.test("a long line whose statement never closes is given up in a bounded time, never compared by halves [10]", () => {
  const line = `a = ( ${"x + 1 ".repeat(MAX_CHECKED_TEXT / 6 - 10)}`;
  const started = performance.now();
  assertEquals(compareMath(line, PAGE), null);
  assertEquals(compareMath(PAGE, line), null);
  assert(performance.now() - started < 4000);
});

Deno.test("every character that can start or break a statement is read without an error [10]", () => {
  const hostile = ["\u0000", "\u2028", "\uD800", "\\", "$", "\\frac{", "}}}}", "\\left(", "\u202e", "İ", "ǅ"].join(" = ");
  const result = compareMath(hostile, hostile);
  assertEquals(result, { onlyB1: 0, onlyB2: 0 });
});

Deno.test("a short exponent or index in braces is the same as without, and as the superscript [10]", () => {
  assertEquals(statementKeys("4x^{2} - 8x = 0"), statementKeys("4x² - 8x = 0"));
  assertEquals(statementKeys("4x^{2} - 8x = 0"), ["4x^2-8x=0"]);
  assertEquals(statementKeys("$(x-3)^{2}=0$"), ["(x-3)^2=0"]);
  assertEquals(statementKeys("u_{1} = 3"), statementKeys("u_1 = 3"));
  assertEquals(compareMath("a) $x^{2} - 12 = 0$\n$S = \{ 3 \}$", "a) x^2 - 12 = 0\nS = {3}"), { onlyB1: 0, onlyB2: 0 });
});

Deno.test("an exponent too long to be one symbol keeps its braces, so a real difference stays one [10]", () => {
  assertEquals(statementKeys("x^{n+1} = 0"), ["x^{n+1}=0"]);
  assertEquals(compareMath("x^{12} = 0", "x^{13} = 0"), { onlyB1: 1, onlyB2: 1 });
});

Deno.test("a statement made of no letter, no digit and no empty set is not a statement of the page [10]", () => {
  assertEquals(compareMath(`${PAGE}\n---\n***`, PAGE), { onlyB1: 0, onlyB2: 0 });
  assertEquals(compareMath(PAGE, `${PAGE}\n\u2205`), { onlyB1: 0, onlyB2: 1 });
});

Deno.test("on synthetic lines, the statements are those of the Math Spike unit it ports, symbol for symbol [10]", () => {
  assert(fixture.length >= 30);
  for (const { input, keys } of fixture) assertEquals(statementKeys(input), keys, JSON.stringify(input));
});
