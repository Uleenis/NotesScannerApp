import { displayDocument, joinsPrevious, pageTitle } from "@/pages/display";
import shapes from "./fixtures/b1-line-shapes.json";

describe("pageTitle", () => {
  test("is the first non-empty line", () => {
    expect(pageTitle("Fernand de Magellan\n\nNationalité: Portugaise")).toBe("Fernand de Magellan");
  });

  test("skips empty lines and lines of spaces before it", () => {
    expect(pageTitle("\n   \n\t\nJour 22\nSuite")).toBe("Jour 22");
  });

  test("drops the spaces around it", () => {
    expect(pageTitle("   Jour 22   \nSuite")).toBe("Jour 22");
  });

  test("reads lines ended by a carriage return too", () => {
    expect(pageTitle("Jour 22\r\nSuite")).toBe("Jour 22");
  });

  test("is the whole text when it has one line", () => {
    expect(pageTitle("Jean de la Fontaine.")).toBe("Jean de la Fontaine.");
  });

  test("is kept as written, mistakes included", () => {
    expect(pageTitle("CÔtes d'Amérique du Sud. ->")).toBe("CÔtes d'Amérique du Sud. ->");
  });

  test("is null for an empty text or a text of spaces", () => {
    expect(pageTitle("")).toBeNull();
    expect(pageTitle(" \n \n")).toBeNull();
  });
});

describe("joinsPrevious", () => {
  test.each([
    ["starts with a lowercase letter", "Projet -> atteindre les Indes orientales, dont iles Moluques", "en Indonésie."],
    ["starts with an accented lowercase letter", "Naissance en 1480 à", "élevé au Portugal"],
    ["starts with a lowercase letter after an opening bracket", "Les ports (Porto", "(mer du Nord)"],
    ["starts with a lowercase letter after an opening quote", "Il a dit", "« oui »"],
    ["follows an arrow", "Passage vers Océan Atl. à Océ oriental ->", "Nom d'océan Pacifique"],
    ["follows a long arrow", "Projet →", "Nouveau départ"],
    ["follows a double arrow", "Cause =>", "Effet"],
    ["follows a comma", "Atteindre les Indes orientales,", "Dont les Moluques"],
    ["follows a colon", "Trajet:", "Côtes d'Amérique du Sud"],
    ["follows a dash", "Peuple inconnu -", "Les Patagons"],
    ["follows an arrow followed by spaces", "Passage ->  ", "Nom"],
  ])("joins a line that %s", (_, previous, line) => {
    expect(joinsPrevious(previous, line)).toBe(true);
  });

  test.each([
    ["starts with a capital after a full stop", "Navigateur et explorateur.", "Projet -> atteindre"],
    ["starts with a capital after plain text", "Lieu de naiss", "Mort -> 27/04/1521"],
    ["starts with a digit", "Naissance", "1480"],
    ["starts with a dash", "Trajet:", "- Côtes d'Amérique du Sud"],
    ["starts with an en dash", "Trajet:", "– côtes"],
    ["starts with a bullet", "Trajet,", "• côtes"],
    ["starts with a star", "Trajet,", "* côtes"],
    ["starts with an arrow made of a dash", "Passage", "-> nom d'océan"],
    ["starts with a lettered item", "Résolutions,", "a) première"],
    ["starts with a numbered item", "Résolutions,", "1. première"],
    ["starts with a numbered item with a bracket", "Résolutions,", "2) première"],
    ["starts with an indented item", "Résolutions,", "   b) deuxième"],
    ["has LaTeX with a dollar sign before", "On pose $x = 2$,", "puis on résout"],
    ["has LaTeX with a dollar sign after", "On résout", "dans $x^2 = 4$"],
    ["has LaTeX with a command before", "Alors \\frac{1}{2},", "et la suite"],
    ["has LaTeX with a command after", "Alors", "\\sqrt{5} est irrationnel"],
  ])("never joins a line that %s", (_, previous, line) => {
    expect(joinsPrevious(previous, line)).toBe(false);
  });

  test("never joins an empty line", () => {
    expect(joinsPrevious("Texte,", "")).toBe(false);
    expect(joinsPrevious("", "texte")).toBe(false);
    expect(joinsPrevious("Texte,", "   ")).toBe(false);
  });
});

describe("displayDocument", () => {
  test("shows the title apart and the lines after it as separate blocks", () => {
    expect(displayDocument("Fernand de Magellan\nNaissance: 1480\nMort -> 27/04/1521")).toEqual({
      title: "Fernand de Magellan",
      blocks: [
        { kind: "line", text: "Naissance: 1480" },
        { kind: "line", text: "Mort -> 27/04/1521" },
      ],
    });
  });

  test("glues a cut line back with one space", () => {
    expect(displayDocument("Titre\nProjet -> atteindre les Indes orientales, dont iles Moluques\nen Indonésie.\nNavigateur").blocks).toEqual([
      { kind: "line", text: "Projet -> atteindre les Indes orientales, dont iles Moluques en Indonésie." },
      { kind: "line", text: "Navigateur" },
    ]);
  });

  test("glues several lines in a row", () => {
    expect(displayDocument("Titre\nTrajet: Côtes ->\nPeuple inconnu\nqui nomme ->\nPatagons").blocks).toEqual([
      { kind: "line", text: "Trajet: Côtes -> Peuple inconnu qui nomme -> Patagons" },
    ]);
  });

  test("adds no space when the cut already has one", () => {
    expect(displayDocument("Titre\nPeuple inconnu \nqui nomme").blocks).toEqual([{ kind: "line", text: "Peuple inconnu qui nomme" }]);
    expect(displayDocument("Titre\nPeuple inconnu\n qui nomme").blocks).toEqual([{ kind: "line", text: "Peuple inconnu qui nomme" }]);
  });

  test("keeps a gap for empty lines and never glues across it", () => {
    expect(displayDocument("Titre\n\nPremier,\n\ndeuxième\n\n\nTroisième").blocks).toEqual([
      { kind: "line", text: "Premier," },
      { kind: "gap" },
      { kind: "line", text: "deuxième" },
      { kind: "gap" },
      { kind: "line", text: "Troisième" },
    ]);
  });

  test("has no gap at the start or at the end", () => {
    expect(displayDocument("Titre\n\n\nCorps\n\n").blocks).toEqual([{ kind: "line", text: "Corps" }]);
  });

  test("keeps LaTeX as written and never glues it", () => {
    expect(displayDocument("Chapitre 1\na) $(x+\\sqrt{5}) = 0$\nb) $4x^2 - 8x = 0$,\n$S = \\{0 ; 4\\}$").blocks).toEqual([
      { kind: "line", text: "a) $(x+\\sqrt{5}) = 0$" },
      { kind: "line", text: "b) $4x^2 - 8x = 0$," },
      { kind: "line", text: "$S = \\{0 ; 4\\}$" },
    ]);
  });

  test("has a title and no block for a one-line text", () => {
    expect(displayDocument("Jean de la Fontaine.")).toEqual({ title: "Jean de la Fontaine.", blocks: [] });
  });

  test("has no title and no block for an empty text", () => {
    expect(displayDocument("")).toEqual({ title: null, blocks: [] });
  });

  test("reads lines ended by a carriage return like the others", () => {
    expect(displayDocument("Titre\r\nPeuple inconnu\r\nqui nomme").blocks).toEqual([{ kind: "line", text: "Peuple inconnu qui nomme" }]);
  });

  test("never changes a character of the text, only its line breaks", () => {
    const text = ["  Titre  ", "", "Nationnalité: Portugaise", "Projet -> atteindre,", "dont iles Moluques", "en Indonésie.", "", "a) CÔtes ->", "peuple", "- tiret,", "puis", "$x$ ,", "fin"].join("\n");
    const { title, blocks } = displayDocument(text);
    const shown = [title ?? "", ...blocks.map((block) => (block.kind === "line" ? block.text : ""))].join("");
    expect(shown.replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
});

describe("the rule on the lines of the B1 readings of the Thinking Spike (criterion 6)", () => {
  type Reading = { lines: string[]; sameLine: (boolean | null)[] };
  const readings: Reading[] = shapes.readings;

  function count() {
    const totals = { glued: 0, gluedWrongly: 0, keptWrongly: 0, keptRightly: 0 };
    for (const { lines, sameLine } of readings) {
      sameLine.forEach((same, index) => {
        if (same === null) {
          return;
        }
        const joins = joinsPrevious(lines[index], lines[index + 1]);
        if (joins && same) {
          totals.glued += 1;
        } else if (joins) {
          totals.gluedWrongly += 1;
        } else if (same) {
          totals.keptWrongly += 1;
        } else {
          totals.keptRightly += 1;
        }
      });
    }
    return totals;
  }

  test("covers the 18 readings of the nine pages of text", () => {
    expect(readings).toHaveLength(18);
    expect(readings.every(({ lines, sameLine }) => sameLine.length === lines.length - 1)).toBe(true);
  });

  test("keeps no word of the readings, only the shape of the lines", () => {
    const characters = new Set(readings.flatMap(({ lines }) => lines.join("").match(/\p{L}|\p{N}/gu) ?? []));
    expect([...characters].sort()).toEqual(["0", "X", "x"]);
  });

  test("glues 156 cut lines back rightly and none wrongly, and leaves 8 cuts in place", () => {
    const totals = count();
    expect(totals.glued).toBe(156);
    expect(totals.gluedWrongly).toBe(0);
    expect(totals.keptWrongly).toBe(8);
  });

  test("counts every line break once", () => {
    const totals = count();
    const breaks = readings.reduce((sum, { sameLine }) => sum + sameLine.filter((same) => same !== null).length, 0);
    expect(totals.glued + totals.gluedWrongly + totals.keptWrongly + totals.keptRightly).toBe(breaks);
  });
});

describe("the underline tags of a page of text [2]", () => {
  test("the title is shown without them", () => {
    expect(pageTitle("<u>La France</u>\n\nUne ligne")).toBe("La France");
  });

  test("the blocks are shown without them", () => {
    expect(displayDocument("Titre\n<u>Une</u> ligne <u>soulignée</u>").blocks).toEqual([{ kind: "line", text: "Une ligne soulignée" }]);
    expect(displayDocument("<u>La France</u>").title).toBe("La France");
  });

  test("any other tag is shown as written", () => {
    expect(pageTitle("<b>La France</b>")).toBe("<b>La France</b>");
  });
});
