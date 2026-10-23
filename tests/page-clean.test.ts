import { cleanView, stripUnderline } from "@/pages/clean";
import { placeWords, type PlacedWord, type WordRecord } from "@/pages/words";

const WORD = /\[\?\]|[0-9A-Za-zÀ-ɏ'\-]+/gu;

function wordsOf(raw: string): WordRecord[] {
  return [...raw.matchAll(WORD)].map((found, index) => {
    const start = Array.from(raw.slice(0, found.index)).length;
    return {
      index,
      line: raw.slice(0, found.index).split("\n").length - 1,
      text: found[0],
      readingA: null,
      readingB1: found[0],
      readingB2: null,
      start,
      end: start + Array.from(found[0]).length,
    };
  });
}

function placed(raw: string): PlacedWord[] {
  const found = placeWords(raw, { words: wordsOf(raw), corrections: [], gaps: [] });
  if (found === null) {
    throw new Error("The test words could not be placed.");
  }
  return found;
}

const view = (raw: string, second: string | null) => cleanView(raw, placed(raw), second);

describe("stripUnderline", () => {
  test("removes the opening and the closing tag and nothing else", () => {
    expect(stripUnderline("<u>La France</u>")).toBe("La France");
    expect(stripUnderline("avant <u>milieu</u> après <u>fin</u>")).toBe("avant milieu après fin");
  });

  test("leaves any other tag, and a lone angle bracket, as written", () => {
    expect(stripUnderline("<b>gras</b> <i>x</i> a < b > c <ul> <U>")).toBe("<b>gras</b> <i>x</i> a < b > c <ul> <U>");
  });

  test("changes nothing in a text without a tag", () => {
    expect(stripUnderline("Fernand de Magellan\n\nPortugaise")).toBe("Fernand de Magellan\n\nPortugaise");
  });
});

describe("cleanView without a second reading", () => {
  test("shows a text without a tag as it is, blank lines included", () => {
    const raw = "Titre\n\nUne ligne\n\nUne autre";
    expect(view(raw, null).text).toBe(raw);
    expect(view(raw, null).words.map((entry) => entry.shown)).toEqual(placed(raw).map((entry) => entry.shown));
  });

  test("removes the tags", () => {
    expect(view("<u>La France</u>\nUne ligne", null).text).toBe("La France\nUne ligne");
  });

  test("places every remaining word where it is in the cleaned text, and drops the words made by the tags", () => {
    const raw = "<u>La France</u>\nUne <u>belle</u> ligne";
    const cleaned = view(raw, null);
    expect(cleaned.text).toBe("La France\nUne belle ligne");
    expect(cleaned.words.map((entry) => cleaned.text.slice(entry.start, entry.end))).toEqual(["La", "France", "Une", "belle", "ligne"]);
    expect(cleaned.words.map((entry) => entry.shown)).toEqual(["La", "France", "Une", "belle", "ligne"]);
    expect(cleaned.words.map((entry) => entry.word.index)).toEqual([1, 2, 4, 6, 8]);
  });

  test("lists the words made by the tags as hidden", () => {
    expect([...view("<u>La France</u>\nUne <u>belle</u> ligne", null).hidden]).toEqual([0, 3, 5, 7]);
    expect(view("Une ligne", null).hidden.size).toBe(0);
  });

  test("keeps the index of the word in the stored page, so a correction still goes to the right word", () => {
    const raw = "<u>La France</u>";
    const all = placed(raw);
    const cleaned = view(raw, null);
    const france = all.find((entry) => entry.shown === "France");
    expect(cleaned.words.find((entry) => entry.shown === "France")?.word.index).toBe(france?.word.index);
  });
});

describe("cleanView with a second reading", () => {
  const first = ["La France", "", "Une ligne", "", "Une autre", "Encore"].join("\n");

  test("keeps a blank line that the second reading also has, between the same lines", () => {
    const second = ["La France", "", "Une ligne", "", "Une autre", "Encore"].join("\n");
    expect(view(first, second).text).toBe(first);
  });

  test("removes a blank line that the second reading does not have", () => {
    const second = ["La France", "Une ligne", "", "Une autre", "Encore"].join("\n");
    expect(view(first, second).text).toBe(["La France", "Une ligne", "", "Une autre", "Encore"].join("\n"));
  });

  test("removes all the blank lines when the second reading has none", () => {
    const second = ["La France", "Une ligne", "Une autre", "Encore"].join("\n");
    expect(view(first, second).text).toBe(["La France", "Une ligne", "Une autre", "Encore"].join("\n"));
  });

  test("removes a run of blank lines as one", () => {
    const raw = "Une\n\n\n  \nDeux";
    expect(view(raw, "Une\nDeux").text).toBe("Une\nDeux");
  });

  test("keeps a run of blank lines when the second reading has one", () => {
    const raw = "Une\n\n\nDeux";
    expect(view(raw, "Une\n\nDeux").text).toBe(raw);
  });

  test("matches the lines by their content without case, accents, spaces or punctuation", () => {
    const raw = "Été à Lisbonne.\n\nPrès du port";
    expect(view(raw, "ete a LISBONNE\n\npres  du  port!").text).toBe(raw);
    expect(view(raw, "ete a LISBONNE\npres  du  port!").text).toBe("Été à Lisbonne.\nPrès du port");
  });

  test("matches a line with or without the underline tags on either side", () => {
    expect(view("<u>La France</u>\n\nUne ligne", "La France\nUne ligne").text).toBe("La France\nUne ligne");
    expect(view("La France\n\nUne ligne", "<u>La France</u>\n\nUne ligne").text).toBe("La France\n\nUne ligne");
  });

  test("keeps the blank line before a line that the second reading does not have", () => {
    const raw = "La France\n\nUne ligne lue de travers\nEncore";
    expect(view(raw, "La France\nUne ligne lue autrement\nEncore").text).toBe(raw);
  });

  test("keeps the blank line after a line that the second reading does not have", () => {
    const raw = "La France\nUne ligne lue de travers\n\nEncore";
    expect(view(raw, "La France\nUne ligne lue autrement\nEncore").text).toBe(raw);
  });

  test("keeps a blank line when a blank line is somewhere between the matching lines in the second reading", () => {
    const raw = "Une\n\nTrois";
    expect(view(raw, "Une\nDeux\n\nTrois").text).toBe(raw);
  });

  test("does not match a line to a line that comes earlier in the second reading", () => {
    const raw = "Deux\n\nUne";
    expect(view(raw, "Une\n\nDeux").text).toBe(raw);
  });

  test("matches a repeated line to its own copy", () => {
    const raw = "Oui\n\nOui\nNon";
    expect(view(raw, "Oui\n\nOui\nNon").text).toBe(raw);
    expect(view(raw, "Oui\nOui\n\nNon").text).toBe("Oui\nOui\nNon");
  });

  test("leaves the blank lines at the start and the end to the display", () => {
    const raw = "\n\nUne\nDeux\n\n";
    expect(view(raw, "Une\nDeux").text).toBe(raw);
  });

  test("reads lines ended by a carriage return too", () => {
    expect(view("Une\r\n\r\nDeux", "Une\r\nDeux").text).toBe("Une\r\nDeux");
    expect(view("Une\r\n\r\nDeux", "Une\r\n\r\nDeux").text).toBe("Une\r\n\r\nDeux");
  });

  test("shows the text as it is when the second reading is empty", () => {
    expect(view(first, "").text).toBe(first);
    expect(view(first, "  \n\n ").text).toBe(first);
  });

  test("keeps every word in its place after lines are removed", () => {
    const raw = "<u>La France</u>\n\nUne ligne\n\nUne autre";
    const cleaned = view(raw, "La France\nUne ligne\nUne autre");
    expect(cleaned.text).toBe("La France\nUne ligne\nUne autre");
    expect(cleaned.words.map((entry) => cleaned.text.slice(entry.start, entry.end))).toEqual(["La", "France", "Une", "ligne", "Une", "autre"]);
  });

  test("never removes a character of a word", () => {
    const raw = "Un mot\n\nDeux mots\n\nTrois mots";
    const cleaned = view(raw, "Un mot\nDeux mots\nTrois mots");
    expect(cleaned.words.map((entry) => entry.shown).join(" ")).toBe("Un mot Deux mots Trois mots");
  });

  test("gives up on a text too large to match and shows it as it is", () => {
    const raw = Array.from({ length: 3000 }, (_, at) => `ligne ${at}\n`).join("\n");
    expect(view(raw, raw.replace(/\n\n/g, "\n")).text).toBe(raw);
  });
});
