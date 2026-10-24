import { frameOf } from "@/pages/frame";
import { excerptParts, replaceWords } from "@/search/text";

describe("excerptParts", () => {
  test("cuts the excerpt on the marked word, counted in code points", () => {
    expect(excerptParts("Le navigateur Magellan part", 14, 22)).toEqual({ before: "Le navigateur ", match: "Magellan", after: " part" });
  });

  test("counts characters outside the basic plane as one", () => {
    expect(excerptParts("\u{1d4b3} = Magellan", 4, 12)).toEqual({ before: "\u{1d4b3} = ", match: "Magellan", after: "" });
  });

  test("marks nothing without a range or with a range that does not fit", () => {
    const whole = { before: "Magellan", match: "", after: "" };
    expect(excerptParts("Magellan", null, null)).toEqual(whole);
    expect(excerptParts("Magellan", 3, 3)).toEqual(whole);
    expect(excerptParts("Magellan", 5, 2)).toEqual(whole);
    expect(excerptParts("Magellan", 0, 9)).toEqual(whole);
    expect(excerptParts("Magellan", -1, 4)).toEqual(whole);
  });
});

describe("excerptParts on a line the page shows differently", () => {
  test("hides the underline tags and keeps the marked range on its word", () => {
    expect(excerptParts("Le <u>Portugal</u> de Magellan", 22, 30)).toEqual({ before: "Le Portugal de ", match: "Magellan", after: "" });
    expect(excerptParts("Le <u>Portugal</u> de Magellan", 6, 14)).toEqual({ before: "Le ", match: "Portugal", after: " de Magellan" });
  });

  test("hides a tag inside the marked word", () => {
    expect(excerptParts("Magel<u>lan</u> part", 0, 15)).toEqual({ before: "", match: "Magellan", after: " part" });
  });

  test("marks nothing when the range is made only of tags", () => {
    expect(excerptParts("a<u>b", 1, 4)).toEqual({ before: "ab", match: "", after: "" });
  });

  test("cuts a long line to a window around the word, with an ellipsis on each cut side", () => {
    const line = `${"a ".repeat(300)}Magellan${" b".repeat(300)}`;
    const parts = excerptParts(line, 600, 608);
    expect(parts.match).toBe("Magellan");
    expect(parts.before.startsWith("…")).toBe(true);
    expect(parts.after.endsWith("…")).toBe(true);
    expect(Array.from(parts.before).length).toBeLessThanOrEqual(81);
    expect(Array.from(parts.after).length).toBeLessThanOrEqual(161);
  });

  test("cuts a long line that marks nothing at its start", () => {
    const parts = excerptParts("word ".repeat(200), null, null);
    expect(parts.match).toBe("");
    expect(parts.after).toBe("");
    expect(parts.before.endsWith("…")).toBe(true);
    expect(Array.from(parts.before).length).toBeLessThanOrEqual(241);
  });

  test("leaves a short line whole", () => {
    expect(excerptParts("Fernand de Magellan", 11, 19)).toEqual({ before: "Fernand de ", match: "Magellan", after: "" });
  });
});

describe("replaceWords", () => {
  test("replaces the word that the search normalised, whatever its case and accents", () => {
    expect(replaceWords("Fernand MAGELAN", [{ word: "magelan", suggestion: "Magellan" }])).toBe("Fernand Magellan");
    expect(replaceWords("Égée", [{ word: "egee", suggestion: "Aegee" }])).toBe("Aegee");
  });

  test("replaces a part of a hyphenated word and every occurrence", () => {
    expect(replaceWords("Jean-Piere Piere", [{ word: "piere", suggestion: "Pierre" }])).toBe("Jean-Pierre Pierre");
  });

  test("applies each replacement to its own word and leaves the other words and the spaces alone", () => {
    const replacements = [
      { word: "magelan", suggestion: "Magellan" },
      { word: "molukes", suggestion: "Moluques" },
    ];
    expect(replaceWords("  Magelan  et   Molukes ", replacements)).toBe("  Magellan  et   Moluques ");
  });

  test("folds the letters the database folds", () => {
    expect(replaceWords("Cœur", [{ word: "coeur", suggestion: "Coeur" }])).toBe("Coeur");
    expect(replaceWords("Œdipe", [{ word: "oedipe", suggestion: "Oedipe" }])).toBe("Oedipe");
    expect(replaceWords("Straße", [{ word: "strasse", suggestion: "Strasse" }])).toBe("Strasse");
    expect(replaceWords("Ægir", [{ word: "aegir", suggestion: "Aegir" }])).toBe("Aegir");
  });

  test("changes nothing when no word of the query matches", () => {
    expect(replaceWords("Magellan", [{ word: "elcano", suggestion: "Elcano" }])).toBe("Magellan");
  });
});

describe("frameOf", () => {
  const photo = { width: 1000, height: 2000 };

  test("gives the box as fractions of the photo", () => {
    expect(frameOf([100, 400, 300, 500], photo)).toEqual({ left: 0.1, top: 0.2, width: 0.2, height: 0.05 });
  });

  test("keeps a box that overshoots the photo by a pixel or two", () => {
    const frame = frameOf([900, 1900, 1001, 2002], photo);
    expect(frame).not.toBeNull();
    expect(frame?.left).toBeCloseTo(0.9);
    expect((frame?.left ?? 0) + (frame?.width ?? 0)).toBeCloseTo(1);
    expect((frame?.top ?? 0) + (frame?.height ?? 0)).toBeCloseTo(1);
  });

  test("refuses a box that does not lie on the photo", () => {
    expect(frameOf([900, 100, 1100, 200], photo)).toBeNull();
    expect(frameOf([100, 1990, 200, 2100], photo)).toBeNull();
    expect(frameOf([2000, 3000, 2100, 3100], photo)).toBeNull();
    expect(frameOf([-5, 0, 100, 100], photo)).toBeNull();
    expect(frameOf([1000.5, 10, 1001.5, 20], photo)).toBeNull();
    expect(frameOf([1000, 10, 1001, 20], photo)).toBeNull();
    expect(frameOf([10, 2000, 20, 2001], photo)).toBeNull();
  });

  test("refuses a box that is empty, reversed or not four numbers, and a photo of no size", () => {
    expect(frameOf([100, 100, 100, 200], photo)).toBeNull();
    expect(frameOf([300, 100, 100, 200], photo)).toBeNull();
    expect(frameOf([100, 300, 200, 200], photo)).toBeNull();
    expect(frameOf([1, 2, 3], photo)).toBeNull();
    expect(frameOf([1, 2, 3, Number.NaN], photo)).toBeNull();
    expect(frameOf([100, 100, 200, 200], { width: 0, height: 0 })).toBeNull();
  });
});
