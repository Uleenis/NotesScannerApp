import {
  addCorrection,
  isWord,
  listWords,
  placeWords,
  suggestionsFor,
  type CorrectionRecord,
  type PageWords,
  type WordRecord,
} from "@/pages/words";
import type { PagesClient } from "@/pages/pages";

function word(index: number, start: number | null, end: number | null, overrides: Partial<WordRecord> = {}): WordRecord {
  const text = overrides.text ?? overrides.readingB1 ?? "mot";
  return { index, line: 0, text, readingA: null, readingB1: text, readingB2: null, start, end, ...overrides };
}

function data(words: WordRecord[], corrections: CorrectionRecord[] = []): PageWords {
  return { words, corrections };
}

describe("placeWords", () => {
  test("puts each word where B1 had it when nothing was changed", () => {
    const text = "Un chat noir";
    const placed = placeWords(text, data([word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chat" }), word(2, 8, 12, { text: "noir" })]));
    expect(placed?.map(({ word: { index }, start, end, shown }) => [index, start, end, shown])).toEqual([
      [0, 0, 2, "Un"],
      [1, 3, 7, "chat"],
      [2, 8, 12, "noir"],
    ]);
  });

  test("moves the next words by the difference a correction made", () => {
    const text = "Un chats noir";
    const placed = placeWords(
      text,
      data([word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chat" }), word(2, 8, 12, { text: "noir" })], [{ tokenIndex: 1, revision: 1, text: "chats" }]),
    );
    expect(placed?.map(({ start, end, shown }) => [start, end, shown])).toEqual([
      [0, 2, "Un"],
      [3, 8, "chats"],
      [9, 13, "noir"],
    ]);
  });

  test("uses the last correction of a word", () => {
    const text = "Un chien";
    const placed = placeWords(
      text,
      data(
        [word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chat" })],
        [
          { tokenIndex: 1, revision: 2, text: "chien" },
          { tokenIndex: 1, revision: 1, text: "chats" },
        ],
      ),
    );
    expect(placed?.[1]).toMatchObject({ start: 3, end: 8, shown: "chien" });
  });

  test("uses the word a rule wrote in place of B1's", () => {
    const text = "Un chats";
    const placed = placeWords(text, data([word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chats", readingB1: "chat", readingA: "chats" })]));
    expect(placed?.[1]).toMatchObject({ start: 3, end: 8, shown: "chats" });
  });

  test("counts in characters, not in the units of a string", () => {
    const text = "😀 chat";
    const placed = placeWords(text, data([word(0, 0, 1, { text: "😀" }), word(1, 2, 6, { text: "chat" })]));
    expect(placed?.map(({ start, end }) => text.slice(start, end))).toEqual(["😀", "chat"]);
  });

  test("shifts by characters when a correction holds a character of two units", () => {
    const text = "a 😀 b";
    const placed = placeWords(text, data([word(0, 0, 1, { text: "a" }), word(1, 2, 3, { text: "x" }), word(2, 4, 5, { text: "b" })], [{ tokenIndex: 1, revision: 1, text: "😀" }]));
    expect(placed?.map(({ start, end }) => text.slice(start, end))).toEqual(["a", "😀", "b"]);
  });

  test("keeps the line breaks between words", () => {
    const text = "Un\nchat";
    const placed = placeWords(text, data([word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chat" })]));
    expect(placed?.map(({ start, end }) => text.slice(start, end))).toEqual(["Un", "chat"]);
  });

  test.each([
    ["a word without a place", [word(0, 0, 2, { text: "Un" }), word(1, null, null, { text: "chat" })], []],
    ["places that overlap", [word(0, 0, 4, { text: "Unch" }), word(1, 3, 7, { text: "chat" })], []],
    ["places out of order", [word(0, 8, 12, { text: "noir" }), word(1, 0, 2, { text: "Un" })], []],
    ["a place beyond the text", [word(0, 0, 2, { text: "Un" }), word(1, 3, 70, { text: "chat" })], []],
    ["a changed word that is not where it should be", [word(0, 0, 2, { text: "Un" }), word(1, 3, 7, { text: "chien", readingB1: "chat" })], []],
    ["a correction that is not in the text", [word(0, 0, 2, { text: "Un" })], [{ tokenIndex: 0, revision: 1, text: "Une" }]],
    ["a correction of a word that does not exist", [word(0, 0, 2, { text: "Un" })], [{ tokenIndex: 9, revision: 1, text: "Une" }]],
  ])("is null for %s", (_, words, corrections) => {
    expect(placeWords("Un chat noir", data(words, corrections))).toBeNull();
  });

  test("has no word to touch when the page has none", () => {
    expect(placeWords("Un chat", data([]))).toEqual([]);
  });
});

describe("suggestionsFor", () => {
  test("lists the distinct readings of A, B1 and B2", () => {
    expect(suggestionsFor(word(0, 0, 4, { readingA: "chat", readingB1: "chat", readingB2: "chas" }))).toEqual([
      { source: "A", text: "chat" },
      { source: "B2", text: "chas" },
    ]);
  });

  test("keeps the first source of a reading that several share", () => {
    expect(suggestionsFor(word(0, 0, 4, { readingA: "chal", readingB1: "chat", readingB2: "chal" }))).toEqual([
      { source: "A", text: "chal" },
      { source: "B1", text: "chat" },
    ]);
  });

  test("leaves out a pass that read nothing there", () => {
    expect(suggestionsFor(word(0, 0, 4, { readingA: null, readingB1: "chat", readingB2: null }))).toEqual([{ source: "B1", text: "chat" }]);
  });
});

describe("isWord", () => {
  test.each(["chat", "l'été", "27/04/1521", "∅", "a".repeat(100)])("accepts %s", (value) => {
    expect(isWord(value)).toBe(true);
  });

  test.each([
    ["nothing", ""],
    ["a space inside", "un chat"],
    ["a space around", " chat"],
    ["a line break", "un\nchat"],
    ["a tab", "un\tchat"],
    ["a no-break space", `un${String.fromCharCode(0xa0)}chat`],
    ["a zero-width space", `un${String.fromCharCode(0x200b)}chat`],
    ["a bidirectional mark", `chat${String.fromCharCode(0x202e)}`],
    ["a soft hyphen", `cha${String.fromCharCode(0xad)}t`],
    ["a byte-order mark", `${String.fromCharCode(0xfeff)}chat`],
    ["a control character", `chat${String.fromCharCode(1)}`],
    ["more than 100 characters", "a".repeat(101)],
  ])("refuses %s", (_, value) => {
    expect(isWord(value)).toBe(false);
  });

  test("counts characters, not units of a string", () => {
    expect(isWord("😀".repeat(100))).toBe(true);
    expect(isWord("😀".repeat(101))).toBe(false);
  });
});

type Outcome = { data: unknown; error: unknown };

function reader(outcomes: Outcome[]) {
  const calls: [string, unknown[]][] = [];
  let next = 0;
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "range"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: Outcome) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcomes[Math.min(next++, outcomes.length - 1)]).then(resolve, reject);
  const from = jest.fn((_table: string) => chain);
  return { client: { from } as unknown as PagesClient, from, calls };
}

const tokenRow = (index: number) => ({
  token_index: index,
  line_index: 0,
  text: "mot",
  reading_a: null,
  reading_b1: "mot",
  reading_b2: null,
  b1_start: index * 4,
  b1_end: index * 4 + 3,
});

describe("listWords", () => {
  test("reads the words and the corrections of the page, in order", async () => {
    const { client, from, calls } = reader([
      { data: [tokenRow(0), tokenRow(1)], error: null },
      { data: [{ token_index: 1, revision: 1, corrected_text: "mat" }], error: null },
    ]);
    const result = await listWords(client, "page-1");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["page_tokens", "corrections"]);
    expect(calls.filter(([name]) => name === "eq")).toEqual([
      ["eq", ["page_id", "page-1"]],
      ["eq", ["page_id", "page-1"]],
    ]);
    expect(result.words.map((entry) => [entry.index, entry.start, entry.end])).toEqual([
      [0, 0, 3],
      [1, 4, 7],
    ]);
    expect(result.corrections).toEqual([{ tokenIndex: 1, revision: 1, text: "mat" }]);
  });

  test("reads on past the first thousand rows", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => tokenRow(index));
    const { client, calls } = reader([
      { data: first, error: null },
      { data: [tokenRow(1000)], error: null },
      { data: [], error: null },
    ]);
    const result = await listWords(client, "page-1");
    expect(result.words).toHaveLength(1001);
    expect(calls.filter(([name]) => name === "range").slice(0, 2)).toEqual([
      ["range", [0, 999]],
      ["range", [1000, 1999]],
    ]);
  });

  test("fails on a page too long to read in full", async () => {
    const full = Array.from({ length: 1000 }, (_, index) => tokenRow(index));
    const { client } = reader([{ data: full, error: null }]);
    await expect(listWords(client, "page-1")).rejects.toThrow();
  });

  test.each([
    ["an error", { data: null, error: { message: "boom" } }],
    ["a result that is not a list", { data: { token_index: 0 }, error: null }],
    ["a row without an index", { data: [{ ...tokenRow(0), token_index: "0" }], error: null }],
    ["a row without B1", { data: [{ ...tokenRow(0), reading_b1: null }], error: null }],
    ["a place of one end only", { data: [{ ...tokenRow(0), b1_end: null }], error: null }],
  ])("fails on %s", async (_, outcome) => {
    const { client } = reader([outcome]);
    await expect(listWords(client, "page-1")).rejects.toThrow();
  });
});

describe("addCorrection", () => {
  function writer(outcome: Outcome | Error) {
    const insert = jest.fn(async (_row: unknown) => {
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    });
    const from = jest.fn((_table: string) => ({ insert }));
    return { client: { from } as unknown as PagesClient, from, insert };
  }

  test("adds one row with the five columns the client may write", async () => {
    const { client, from, insert } = writer({ data: null, error: null });
    const result = await addCorrection(client, "page-1", 4, "chat", "B1");
    expect(result).toEqual({ status: "saved" });
    expect(from).toHaveBeenCalledWith("corrections");
    expect(insert).toHaveBeenCalledWith({ page_id: "page-1", token_index: 4, corrected_text: "chat", chosen_from: "B1", from_queue: false });
  });

  test("writes the keyboard as a source of its own", async () => {
    const { client, insert } = writer({ data: null, error: null });
    await addCorrection(client, "page-1", 4, "chat", "keyboard");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ chosen_from: "keyboard" }));
  });

  test("never sends a word the database would refuse", async () => {
    const { client, insert } = writer({ data: null, error: null });
    expect(await addCorrection(client, "page-1", 4, "un chat", "keyboard")).toEqual({ status: "refused" });
    expect(insert).not.toHaveBeenCalled();
  });

  test("tells a refusal of the database from another failure", async () => {
    expect(await addCorrection(writer({ data: null, error: { code: "23514", message: "reading_mismatch" } }).client, "p", 0, "chat", "A")).toEqual({
      status: "refused",
    });
    expect(await addCorrection(writer({ data: null, error: { code: "42501", message: "denied" } }).client, "p", 0, "chat", "A")).toEqual({
      status: "error",
    });
  });

  test("tells a lost network from another failure", async () => {
    expect(await addCorrection(writer(new TypeError("Network request failed")).client, "p", 0, "chat", "A")).toEqual({ status: "network" });
    expect(await addCorrection(writer({ data: null, error: { message: "Network request failed" } }).client, "p", 0, "chat", "A")).toEqual({
      status: "network",
    });
  });
});
