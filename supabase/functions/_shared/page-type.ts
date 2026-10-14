export type PageType = "text" | "math" | "unsupported_script";

const MATH_COMMANDS = [
  "frac", "dfrac", "tfrac", "cfrac", "binom", "sqrt",
  "sum", "prod", "coprod", "int", "iint", "iiint", "oint", "lim", "limsup", "liminf", "sup", "inf", "max", "min",
  "infty", "partial", "nabla", "cdot", "cdots", "ldots", "times", "div", "pm", "mp",
  "le", "leq", "ge", "geq", "neq", "approx", "equiv", "sim", "simeq", "cong", "propto",
  "to", "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow", "mapsto", "implies", "iff",
  "in", "notin", "subset", "subseteq", "supset", "supseteq", "cup", "cap", "emptyset", "forall", "exists", "neg", "land", "lor",
  "mathbb", "mathrm", "mathcal", "mathbf", "mathit", "operatorname", "vec", "overline", "underline", "hat", "bar", "tilde", "dot", "ddot",
  "log", "ln", "exp", "sin", "cos", "tan", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det",
  "left", "right", "begin", "end",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu",
  "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
];

const DELIMITED = [/\$[^$]+\$/, /\\\[[\s\S]*?\\\]/, /\\\([\s\S]*?\\\)/];

const COMMAND = new RegExp(`\\\\(?:${MATH_COMMANDS.join("|")})(?![A-Za-z])`);

const LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

function holdsLatex(text: string): boolean {
  return DELIMITED.some((pattern) => pattern.test(text)) || COMMAND.test(text);
}

function mostlyNotLatin(text: string): boolean {
  const letters = text.match(LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return letters - latin > latin;
}

export function pageTypeOf(b1: string): PageType {
  if (holdsLatex(b1)) return "math";
  if (mostlyNotLatin(b1)) return "unsupported_script";
  return "text";
}
