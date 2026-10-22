import { displayDocument, displayPieces, type Piece } from "@/pages/display";

const joined = (pieces: Piece[]) => pieces.map((piece) => piece.text).join("");

describe("displayPieces", () => {
  test("gives the same text as displayDocument, block by block", () => {
    const text = ["Magellan", "", "Nationalité: Portugaise", "Projet -> atteindre les Indes,", "dont iles Moluques", "en Indonésie.", "", "  Mort -> 27/04/1521  "].join("\n");
    const flat = displayDocument(text);
    const laid = displayPieces(text);
    expect(laid.title === null ? null : joined(laid.title)).toBe(flat.title);
    expect(laid.blocks.map((block) => (block.kind === "gap" ? block : { kind: "line", text: joined(block.pieces) }))).toEqual(flat.blocks);
  });

  test("gives each piece its place in the text it came from", () => {
    const text = "Titre  \nUn mot,\ndeux mots\n";
    const laid = displayPieces(text);
    for (const piece of [...(laid.title ?? []), ...laid.blocks.flatMap((block) => (block.kind === "gap" ? [] : block.pieces))]) {
      if (piece.offset !== null) {
        expect(text.slice(piece.offset, piece.offset + piece.text.length)).toBe(piece.text);
      }
    }
  });

  test("marks the space it adds between glued lines as having no place", () => {
    const laid = displayPieces("Titre\nProjet ->\natteindre");
    const block = laid.blocks[0];
    expect(block.kind).toBe("line");
    if (block.kind === "line") {
      expect(block.pieces.map((piece) => [piece.text, piece.offset !== null])).toEqual([
        ["Projet ->", true],
        [" ", false],
        ["atteindre", true],
      ]);
    }
  });

  test("counts a carriage return before a line break", () => {
    const text = "Titre\r\nPremière\r\nSeconde";
    const laid = displayPieces(text);
    const offsets = laid.blocks.flatMap((block) => (block.kind === "gap" ? [] : block.pieces.map((piece) => piece.offset)));
    expect(offsets).toEqual([text.indexOf("Première"), text.indexOf("Seconde")]);
  });

  test("trims the title and keeps the place of what is left", () => {
    const text = "\n   Jour 22   \nSuite";
    const laid = displayPieces(text);
    expect(laid.title).toEqual([{ text: "Jour 22", offset: text.indexOf("Jour 22") }]);
  });

  test("has no title and no block for an empty text", () => {
    expect(displayPieces("  \n ")).toEqual({ title: null, blocks: [] });
  });
});
