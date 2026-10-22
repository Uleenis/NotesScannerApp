import { alignEdit, MAX_EDIT_CHARACTERS } from "@/pages/edit";
import places from "./fixtures/edit-places.json";
import { isWord, placeWords, type CorrectionRecord, type GapRecord, type PlacedWord, type WordRecord } from "@/pages/words";

const WORD = /\[\?\]|[0-9A-Za-z\u00c0-\u024f\u0300-\u036f'\u2019\u2018\u00b4\u02bc\-\u2010-\u2015]+/gu;
const JOINERS = /['\u2019\u2018\u00b4\u02bc\-\u2010-\u2015]/gu;

function positionsOf(raw: string): WordRecord[] {
  const words: WordRecord[] = [];
  for (const found of raw.matchAll(WORD)) {
    if (found[0] !== "[?]" && found[0].replace(JOINERS, "").replace(/[\u0300-\u036f]/gu, "") === "") {
      continue;
    }
    const start = Array.from(raw.slice(0, found.index)).length;
    words.push({
      index: words.length,
      line: raw.slice(0, found.index).split("\n").length - 1,
      text: found[0],
      readingA: null,
      readingB1: found[0],
      readingB2: null,
      start,
      end: start + Array.from(found[0]).length,
    });
  }
  return words;
}

type State = { raw: string; words: WordRecord[]; corrections: CorrectionRecord[]; gaps: GapRecord[] };

function fresh(raw: string): State {
  return { raw, words: positionsOf(raw), corrections: [], gaps: [] };
}

function shownText(state: State): string {
  const raw = Array.from(state.raw);
  const latest = new Map<number, string>();
  for (const correction of [...state.corrections].sort((a, b) => a.revision - b.revision)) {
    latest.set(correction.tokenIndex, correction.text);
  }
  const gap = new Map(state.gaps.map((entry) => [entry.index, entry.text]));
  let text = "";
  let end = 0;
  state.words.forEach((word, at) => {
    const start = word.start ?? 0;
    text += (gap.get(at) ?? raw.slice(end, start).join("")) + (latest.get(word.index) ?? raw.slice(start, word.end ?? 0).join(""));
    end = word.end ?? 0;
  });
  return text + (gap.get(state.words.length) ?? raw.slice(end).join(""));
}

function place(state: State): PlacedWord[] {
  const placed = placeWords(shownText(state), state);
  if (placed === null) {
    throw new Error("The words cannot be placed.");
  }
  return placed;
}

function rawGaps(state: State): string[] {
  const raw = Array.from(state.raw);
  const gaps: string[] = [];
  let end = 0;
  for (const word of state.words) {
    gaps.push(raw.slice(end, word.start ?? 0).join(""));
    end = word.end ?? 0;
  }
  gaps.push(raw.slice(end).join(""));
  return gaps;
}

function apply(state: State, words: { token_index: number; text: string }[], gaps: { gap_index: number; text: string }[]): State {
  const next: State = { ...state, corrections: [...state.corrections], gaps: [...state.gaps] };
  for (const word of words) {
    const revision = next.corrections.filter((correction) => correction.tokenIndex === word.token_index).length + 1;
    next.corrections.push({ tokenIndex: word.token_index, revision, text: word.text });
  }
  const originals = rawGaps(state);
  for (const gap of gaps) {
    next.gaps = next.gaps.filter((entry) => entry.index !== gap.gap_index);
    if (gap.text !== originals[gap.gap_index]) {
      next.gaps.push({ index: gap.gap_index, text: gap.text });
    }
  }
  return next;
}

function edited(state: State, text: string) {
  const result = alignEdit(shownText(state), place(state), text);
  if (result.status !== "edit") {
    return { result, state };
  }
  return { result, state: apply(state, result.words, result.gaps) };
}

const PAGE = "Bonjour Paul,\nje suis a Paris. L'\u00e9t\u00e9 est l\u00e0 !";

describe("alignEdit", () => {
  test("changes nothing for the same text", () => {
    const state = fresh(PAGE);
    expect(alignEdit(PAGE, place(state), PAGE)).toEqual({ status: "same" });
  });

  test("makes a changed word a correction of its position and nothing else", () => {
    const { result, state } = edited(fresh(PAGE), PAGE.replace("Paul", "Pierre"));
    expect(result).toEqual({ status: "edit", words: [{ token_index: 1, text: "Pierre" }], gaps: [] });
    expect(shownText(state)).toBe(PAGE.replace("Paul", "Pierre"));
  });

  test("makes an added word a gap and no correction", () => {
    const text = PAGE.replace("suis a", "suis tres a");
    const { result, state } = edited(fresh(PAGE), text);
    expect(result).toEqual({ status: "edit", words: [], gaps: [{ gap_index: 4, text: " tres " }] });
    expect(shownText(state)).toBe(text);
  });

  test("keeps an added word before the first word and after the last", () => {
    const text = `Titre\n${PAGE} Merci`;
    const { result, state } = edited(fresh(PAGE), text);
    expect(result).toMatchObject({ status: "edit", words: [] });
    expect(shownText(state)).toBe(text);
  });

  test("makes a changed punctuation a gap and no correction", () => {
    const text = PAGE.replace("Paul,", "Paul;");
    const { result } = edited(fresh(PAGE), text);
    expect(result).toEqual({ status: "edit", words: [], gaps: [{ gap_index: 2, text: ";\n" }] });
  });

  test("makes a cut line a gap and no correction", () => {
    const text = PAGE.replace("suis a Paris", "suis a\nParis");
    const { result } = edited(fresh(PAGE), text);
    expect(result).toEqual({ status: "edit", words: [], gaps: [{ gap_index: 5, text: "\n" }] });
  });

  test("makes a deleted word a correction with no text", () => {
    const text = PAGE.replace("je suis", "suis");
    const { result, state } = edited(fresh(PAGE), text);
    expect(result).toMatchObject({ status: "edit", words: [{ token_index: 2, text: "" }] });
    expect(shownText(state)).toBe(text);
  });

  test("puts the first new word of a hole on the first position of a hole that has more positions", () => {
    const state = fresh("un grand chat noir");
    const { result, state: next } = edited(state, "un chien noir");
    expect(result).toMatchObject({ status: "edit", words: [{ token_index: 1, text: "chien" }, { token_index: 2, text: "" }] });
    expect(shownText(next)).toBe("un chien noir");
  });

  test("keeps the extra new words of a hole that has fewer positions as the text of the user", () => {
    const { result, state } = edited(fresh("un chat noir"), "un gros chien noir");
    expect(result).toMatchObject({ status: "edit", words: [{ token_index: 1, text: "gros" }], gaps: [{ gap_index: 2, text: " chien " }] });
    expect(shownText(state)).toBe("un gros chien noir");
  });

  test("does not mistake a word that grew for a punctuation", () => {
    const { result } = edited(fresh("un chat"), "un chats");
    expect(result).toEqual({ status: "edit", words: [{ token_index: 1, text: "chats" }], gaps: [] });
  });

  test("keeps a word with an apostrophe or a hyphen whole", () => {
    const state = fresh("c'est l'\u00e9t\u00e9 peut-\u00eatre");
    const { result } = edited(state, "c'est l'hiver peut-\u00eatre");
    expect(result).toEqual({ status: "edit", words: [{ token_index: 1, text: "l'hiver" }], gaps: [] });
  });

  test("keeps a word whose accent is written as two characters", () => {
    const state = fresh("e\u0301te\u0301 chat");
    const { result, state: next } = edited(state, "e\u0301te\u0301 chien");
    expect(result).toEqual({ status: "edit", words: [{ token_index: 1, text: "chien" }], gaps: [] });
    expect(shownText(next)).toBe("e\u0301te\u0301 chien");
  });

  test("lets a position hold a word with a character that is no letter, as the keyboard allowed", () => {
    const base = fresh("un chat noir");
    const first = edited(base, "un chat, noir");
    const second = edited(apply(base, [{ token_index: 1, text: "chat," }], [{ gap_index: 2, text: " " }]), "un chat, noir !");
    expect(first.result).toMatchObject({ status: "edit" });
    expect(second.result).toEqual({ status: "edit", words: [], gaps: [{ gap_index: 3, text: " !" }] });
  });

  test.each([
    ["3.5", "paid x euros", 1, "paid 3.5 euros", "paid 3.5 dollars", { token_index: 2, text: "dollars" }],
    ["a/b", "go to x now", 2, "go to a/b now", "go to a/b then", { token_index: 3, text: "then" }],
    ['"hello', "x world foo", 0, '"hello world foo', '"hello world bar', { token_index: 2, text: "bar" }],
    ["(x)", "see x now", 1, "see (x) now", "see (x) later", { token_index: 2, text: "later" }],
  ])("keeps a position whose word is %s when it is not the word that changed", (_, raw, index, shown, text, expected) => {
    const base = apply(fresh(raw), [{ token_index: index, text: _ }], []);
    expect(shownText(base)).toBe(shown);
    const { result, state } = edited(base, text);
    expect(result).toEqual({ status: "edit", words: [expected], gaps: [] });
    expect(shownText(state)).toBe(text);
  });

  test("still gives the exact text when the word with a character that is no letter is the one that changed", () => {
    const base = apply(fresh("paid x euros"), [{ token_index: 1, text: "3.5" }], []);
    const { result, state } = edited(base, "paid 4.5 euros");
    expect(result).toMatchObject({ status: "edit" });
    expect(shownText(state)).toBe("paid 4.5 euros");
  });

  test("does not take a word with a character that is no letter from the inside of another word", () => {
    const base = apply(fresh("paid x euros"), [{ token_index: 1, text: "3.5" }], []);
    const { result, state } = edited(base, "paid 13.55 euros");
    expect(result).toMatchObject({ status: "edit" });
    expect(shownText(state)).toBe("paid 13.55 euros");
  });

  test("leaves a deleted word alone, whatever the user does around it", () => {
    const base = apply(fresh("un grand chat noir"), [{ token_index: 1, text: "" }], [{ gap_index: 1, text: " " }, { gap_index: 2, text: "" }]);
    expect(shownText(base)).toBe("un chat noir");
    const { result, state } = edited(base, "un chat blanc");
    expect(result).toEqual({ status: "edit", words: [{ token_index: 3, text: "blanc" }], gaps: [] });
    expect(shownText(state)).toBe("un chat blanc");
  });

  test("puts the whole text in the one gap of a page with no word", () => {
    const result = alignEdit("$x = 1$", [], "$x = 2$");
    expect(result).toEqual({ status: "edit", words: [], gaps: [{ gap_index: 0, text: "$x = 2$" }] });
  });

  test("accepts an empty text", () => {
    const { result, state } = edited(fresh("un chat"), "");
    expect(result).toMatchObject({ status: "edit" });
    expect(shownText(state)).toBe("");
  });

  test("never makes a correction the database would refuse", () => {
    const long = "a".repeat(101);
    const { result, state } = edited(fresh("un chat noir"), `un ${long} noir`);
    expect(result).toMatchObject({ status: "edit" });
    if (result.status === "edit") {
      expect(result.words.every((word) => word.text === "" || isWord(word.text))).toBe(true);
    }
    expect(shownText(state)).toBe(`un ${long} noir`);
  });

  test("refuses a text over the size the database takes", () => {
    const state = fresh("un chat");
    expect(alignEdit("un chat", place(state), "x".repeat(MAX_EDIT_CHARACTERS + 1))).toEqual({ status: "refused" });
  });

  test("refuses an edit that changes too many words to be a correction each", () => {
    const raw = Array.from({ length: 2500 }, (_, index) => `mot${index % 10}`).join(" ");
    const state = fresh(raw);
    const text = Array.from({ length: 2500 }, (_, index) => `xyz${index % 10}`).join(" ");
    expect(alignEdit(raw, place(state), text)).toEqual({ status: "refused" });
  });

  test("handles a long page with a few changes at its two ends", () => {
    const raw = Array.from({ length: 6000 }, (_, index) => `mot${index}`).join(" ");
    const state = fresh(raw);
    const text = raw.replace("mot0 ", "debut ").replace("mot5999", "fin");
    const { result, state: next } = edited(state, text);
    expect(result).toMatchObject({ status: "edit", words: [{ token_index: 0, text: "debut" }, { token_index: 5999, text: "fin" }] });
    expect(shownText(next)).toBe(text);
  });
});

describe("alignEdit on random edits", () => {
  const CORPUS = "Bonjour Paul,\nje suis a Paris. L'\u00e9t\u00e9 est l\u00e0 !\n\nOn a vu 3 chats -- noirs; peut-\u00eatre 4 [?] x\u00b2 + 1 = 2.\nFin.";
  const PIECES = ["(Paul)", "3.5", "a/b", "chat", "un", "\n", " ", ",", ".", " - ", "l'", "Paris", "\u00e9", "3", "\n\n", "[?]", "\u{1f600}", "mot", "  "];

  function random(seed: number): () => number {
    let value = seed;
    return () => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    };
  }

  function mutate(text: string, next: () => number): string {
    const points = Array.from(text);
    const at = Math.floor(next() * (points.length + 1));
    const kind = Math.floor(next() * 4);
    const piece = PIECES[Math.floor(next() * PIECES.length)];
    if (kind === 0) {
      points.splice(at, 0, piece);
    } else if (kind === 1) {
      points.splice(at, Math.min(points.length - at, 1 + Math.floor(next() * 6)));
    } else if (kind === 2) {
      points.splice(at, Math.min(points.length - at, 1 + Math.floor(next() * 6)), piece);
    } else {
      points.splice(at, 0, piece, piece);
    }
    return points.join("");
  }

  test.each(Array.from({ length: 400 }, (_, seed) => seed))("gives exactly the text of the user and keeps the words placeable: seed %i", (seed) => {
    const next = random(seed + 1);
    let state = apply(fresh(CORPUS), [{ token_index: 1, text: "(Paul)" }, { token_index: 3, text: "a/b" }, { token_index: 8, text: "3.5" }], []);
    for (let round = 0; round < 3; round += 1) {
      let text = shownText(state);
      for (let step = 0, steps = 1 + Math.floor(next() * 5); step < steps; step += 1) {
        text = mutate(text, next);
      }
      const done = edited(state, text);
      if (done.result.status === "same") {
        expect(text).toBe(shownText(state));
        continue;
      }
      expect(done.result.status).toBe("edit");
      expect(shownText(done.state)).toBe(text);
      expect(placeWords(text, done.state)).not.toBeNull();
      if (done.result.status === "edit") {
        expect(done.result.words.every((word) => word.text === "" || isWord(word.text))).toBe(true);
        expect(new Set(done.result.words.map((word) => word.token_index)).size).toBe(done.result.words.length);
      }
      state = done.state;
    }
  });
});

describe("the words after an edit the database applied", () => {
  test.each(places.map((entry) => [entry.name, entry] as const))("the client finds the text and the words the database left: %s", (_, entry) => {
    const base: State = { raw: entry.raw, words: entry.words, corrections: [], gaps: [] };
    const state = apply(base, entry.payload.words, entry.payload.gaps);
    expect(shownText(state)).toBe(entry.shown);
    const placed = placeWords(entry.shown, state);
    expect(placed).not.toBeNull();
    expect(placed).toHaveLength(entry.words.length);
  });
});
