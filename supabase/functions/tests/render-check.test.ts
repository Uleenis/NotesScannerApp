import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkFidelity, fingerprint, MAX_RENDER_INPUT, MAX_RENDER_OUTPUT, renderInput } from "../_shared/render-check.ts";
import type { Fidelity } from "../_shared/render-check.ts";

type Reason = Extract<Fidelity, { ok: false }>["reason"];

const PLAIN = "Les suites\nUne suite converge si elle est bornée.\nExemples\nLa suite 1/n\nLa suite (-1)^n";

function accepted(input: string, output: string) {
  assertEquals(checkFidelity(input, output), { ok: true });
}

function discarded(input: string, output: string, reason: Reason = "text_changed") {
  assertEquals(checkFidelity(input, output), { ok: false, reason });
}

Deno.test("the input drops the underline tags of the model and nothing else [3]", () => {
  assertEquals(renderInput("<u>La France</u>\nune ligne\n\n\nfin  "), "La France\nune ligne\n\n\nfin  ");
  assertEquals(renderInput("a <b> c < d"), "a <b> c < d");
});

Deno.test("the fingerprint is the SHA-256 of the input in 64 lowercase hexadecimal characters [4]", async () => {
  assertEquals(await fingerprint("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assertEquals((await fingerprint("é")).length, 64);
  assert((await fingerprint("a")) !== (await fingerprint("b")));
});

Deno.test("a rendering that adds only the accepted marks is accepted [3]", () => {
  accepted(PLAIN, "# Les suites\n\nUne suite converge si elle est **bornée**.\n\n## Exemples\n\n- La suite 1/n\n- La suite (-1)^n");
  accepted(PLAIN, "## Les suites\nUne suite *converge* si elle est _bornée_.\n### Exemples\n1. La suite 1/n\n2. La suite (-1)^n");
  accepted(PLAIN, "### Les suites\n\n* Une suite converge si elle est bornée.\n  + Exemples\n  + La suite 1/n\n\n+ La suite (-1)^n");
  accepted(PLAIN, "Les suites\n\n***Une suite*** converge si elle est bornée.\n\nExemples\n\nLa suite 1/n\n\nLa suite (-1)^n");
  accepted("a\nb", "- a\n  - b");
  accepted("a  b\n\n\n c", "a b c");
});

Deno.test("an emphasis may span the lines of one paragraph or list item, not a paragraph break [3]", () => {
  const input = "Projet -> atteindre les Indes\norientales, dont iles\nMoluques en Indonésie.";
  accepted(input, "Projet -> atteindre **les Indes\norientales, dont** iles\nMoluques en Indonésie.");
  accepted(input, "Projet -> atteindre *les Indes\norientales,\ndont iles* Moluques en Indonésie.");
  accepted("a b\nc d", "- **a b\nc** d");
  discarded("a b\n\nc d", "a **b\n\nc** d");
  discarded("a b\nc d", "# **a b\nc** d");
  discarded("a b\nc d", "- **a b\n- c** d");
  discarded(input, "Projet -> atteindre **les Indes\norientales, dont iles\nMoluques en Indonésie.");
});

Deno.test("a rendering that touches a word or a sign is discarded [3]", () => {
  discarded(PLAIN, PLAIN.replace("converge", "diverge"));
  discarded(PLAIN, PLAIN.replace("bornée", "bornee"));
  discarded(PLAIN, PLAIN.replace("est bornée.", "est bornée"));
  discarded(PLAIN, `${PLAIN}\nMerci`);
  discarded(PLAIN, PLAIN.replace("Les suites\n", ""));
  discarded(PLAIN, PLAIN.replace("Exemples", "Exemples :"));
  discarded("un deux trois", "trois un deux");
  discarded("un deux", "un  deux deux");
  discarded("un deux", "");
  discarded("1/n", "n/1");
});

Deno.test("a rendering that moves a line is discarded [3]", () => {
  discarded("alpha\nbeta\ngamma", "alpha\ngamma\nbeta");
  discarded("alpha\nbeta", "- beta\n- alpha");
});

Deno.test("a rendering that touches a formula is discarded, one that keeps it is accepted [3]", () => {
  const input = "Théorème\n$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$";
  accepted(input, "## Théorème\n\n$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$");
  discarded(input, input.replace("(n+1)", "(n-1)"));
  discarded(input, input.replace("\\sum_{k=1}^{n}", "\\sum_{k=0}^{n}"));
  discarded(input, input.replace("\\int_0^1", "\\int_0^2"));
  discarded(input, input.replace("\\frac{1}{3}", "\\frac13"));
  discarded(input, input.replace("$$\\int", "$\\int"));
});

Deno.test("a mark that stays in the input as written does not count as a mark [3]", () => {
  accepted("- a\n- b", "- a\n- b");
  discarded("- a\n- b", "a\nb");
  accepted("2 * 3 * 4", "2 * 3 * 4");
  accepted("a_1 + b_2", "a_1 + b_2");
  accepted("#hashtag", "#hashtag");
});

Deno.test("a mark that is not closed or not at the start of a line is discarded [3]", () => {
  discarded("un deux", "**un deux");
  discarded("un deux", "un deux**");
  discarded("un deux", "un # deux");
  discarded("un deux", "un - deux");
  discarded("un deux", "un deux ***");
  discarded("un deux trois", "un **deux* trois");
});

Deno.test("a heading of level 4, a list nested too deep and a tab are discarded [3]", () => {
  discarded("un", "#### un");
  discarded("un", "####### un");
  discarded("un", "      - un");
  discarded("un", "\t- un");
});

Deno.test("html, a link, an image, code, a table, a quote and an escape are discarded [3]", () => {
  discarded("un deux", "<b>un</b> deux", "refused_mark");
  discarded("un deux", "un deux<script>alert(1)</script>", "refused_mark");
  discarded("un deux", "[un](https://example.test) deux", "refused_mark");
  discarded("un deux", "![un](https://example.test/a.png) deux", "refused_mark");
  discarded("un deux", "`un` deux", "refused_mark");
  discarded("un deux", "```\nun deux\n```", "refused_mark");
  discarded("un deux", "| un | deux |\n|---|---|", "refused_mark");
  discarded("un deux", "> un deux", "refused_mark");
  discarded("un * deux", "un \\* deux", "refused_mark");
  discarded("un deux", "<https://example.test>un deux", "refused_mark");
  discarded("un deux", "un deux\n\n---", "text_changed");
  discarded("un deux", "un\n===\ndeux", "text_changed");
});

Deno.test("html, brackets and backslashes already in the input stay text and are accepted [3]", () => {
  const input = "Si a < b et c > d alors [1] et |x| et \\alpha";
  accepted(input, input);
  accepted(input, `## ${input}`);
  discarded(input, `${input} <b>`, "refused_mark");
});

Deno.test("an output longer than the bound is discarded whatever it holds [3]", () => {
  assertEquals(MAX_RENDER_OUTPUT, 60_000);
  assertEquals(MAX_RENDER_INPUT, 20_000);
  const input = "mot ".repeat(10);
  discarded(input, `${input}${" ".repeat(MAX_RENDER_OUTPUT)}`, "output_too_long");
  accepted(input, `${input}${" ".repeat(1000)}`);
});

Deno.test("a rendering with only whitespace differences is accepted, with a letter more it is not [3]", () => {
  accepted("un\ndeux\ntrois", "un deux\r\ntrois");
  discarded("un\ndeux\ntrois", "un deuxx trois");
});

Deno.test("a mark inside a formula is part of the formula and cannot be dropped [3]", () => {
  discarded("$x^*$ et $y^*$", "$x^$ et $y^$");
  discarded("$(x)_{1} (y)_{2}$", "$(x){1} (y){2}$");
  discarded("$$a_1 * b_2$$", "$$a1 * b2$$");
  discarded("\(a_1 + b_1\)", "\(a1 + b1\)");
  discarded("\begin{align}a_1 &= b_1\end{align}", "\begin{align}a1 &= b1\end{align}");
  accepted("$x^*$ et $y^*$", "## $x^*$ et **$y^*$**");
  accepted("$$a_1 * b_2$$", "$$a_1 * b_2$$");
});

Deno.test("a list keeps its numbers: renumbering is discarded, a new list counting from 1 is accepted [3]", () => {
  discarded("3. foo\n4. bar", "1. foo\n1. bar");
  discarded("un\ndeux", "2. un\n1. deux");
  discarded("un\ndeux", "1. un\n3. deux");
  discarded("un\ndeux", "0. un\n1. deux");
  accepted("3. foo\n4. bar", "3. foo\n4. bar");
  accepted("a\nb\nc\nd", "1. a\n2. b\n\n1. c\n2. d");
});

Deno.test("an operator or a sign of the input that looks like a mark cannot be dropped [3]", () => {
  discarded("x**2 + y**2", "x2 + y2");
  discarded("(a)*(b)*(c)", "(a)(b)(c)");
  discarded("- 3 + 2", "3 + 2");
  discarded("+ 3 - 2", "3 - 2");
  discarded("a *b* c", "a b c");
  discarded("# 3", "3");
  accepted("x**2 + y**2", "x**2 + y**2");
  accepted("- 3 + 2", "- 3 + 2");
  accepted("a *b* c", "a *b* c");

  accepted("x**2 + y", "- x**2 + y");
});
