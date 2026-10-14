import { assertEquals } from "jsr:@std/assert@1";
import { pageTypeOf } from "../_shared/page-type.ts";

Deno.test("B1 with LaTeX delimiters is a page of math [5]", () => {
  for (const b1 of [
    "Soit $x^2 + 1$ une fonction",
    "$$\nx = 2\n$$",
    "On a \\[ a = b \\] donc",
    "On a \\( a = b \\) donc",
    "\\begin{align}\na &= b\n\\end{align}",
    "Prix : 5$ et 10$",
  ]) {
    assertEquals(pageTypeOf(b1), "math", b1);
  }
});

Deno.test("B1 with a math command and no delimiter is a page of math [5]", () => {
  for (const b1 of ["\\frac{1}{2}", "\\sum_{i=1}^n i", "x \\to \\infty", "\\sqrt{2} est irrationnel", "\\int f", "\\alpha + \\beta", "a \\leq b", "\\lim f(x)"]) {
    assertEquals(pageTypeOf(b1), "math", b1);
  }
});

Deno.test("plain text, a lone dollar or a backslash that is no math command is text", () => {
  for (const b1 of [
    "Rendez-vous chez le dentiste mardi 14h",
    "Ça coûte 5 $ seulement",
    "Le dossier C:\\Users\\tim",
    "Un mot illisible [?] ici",
    "\\top secret",
    "\\textbf ne compte pas",
    "",
    "123 456",
  ]) {
    assertEquals(pageTypeOf(b1), "text", b1);
  }
});

Deno.test("B1 whose letters are mostly not Latin is in an unsupported script [6]", () => {
  for (const b1 of ["Καλημέρα κόσμε, τι κάνεις;", "Привет, как дела у тебя сегодня?", "今日は良い天気です", "Ελληνικά\nκαι λίγο français"]) {
    assertEquals(pageTypeOf(b1), "unsupported_script", b1);
  }
});

Deno.test("Latin letters with accents and a few foreign letters stay text", () => {
  for (const b1 of ["Œuvre très complète, déjà lue à l'été", "La longueur d'onde λ vaut 500 nm environ", "abc αβγ"]) {
    assertEquals(pageTypeOf(b1), "text", b1);
  }
});

Deno.test("math wins over the script: a page of formulas in Greek letters is math", () => {
  assertEquals(pageTypeOf("$\\alpha$ αβγδεζηθ"), "math");
});
