import { parseRendering, type RichBlock } from "@/render/markdown";

const LINE_MARK = /^ {0,4}(?:(#{1,3})|([-*+])|(\d{1,3})\.)[ \t]+/;
const BOLD = /\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*/g;
const STAR = /(?<![\p{L}\p{N}*])\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*(?![\p{L}\p{N}*])/gu;
const UNDERSCORE = /(?<![\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu;

function serverText(text: string): string {
  const units: string[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0) {
      units.push(lines.join(" ").replace(BOLD, "$1").replace(STAR, "$1").replace(UNDERSCORE, "$1"));
    }
    lines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      close();
      continue;
    }
    const mark = LINE_MARK.exec(line);
    if (mark === null) {
      lines.push(line);
      continue;
    }
    close();
    lines.push(line.replace(LINE_MARK, ""));
    if (mark[1] !== undefined) {
      close();
    }
  }
  close();
  return units.join(" ").replace(/\s+/g, " ").trim();
}

function clientText(blocks: RichBlock[]): string {
  return blocks
    .map((block) => (block.kind === "display" ? block.source : block.spans.map((span) => (span.kind === "text" ? span.text : span.source)).join("")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function styles(blocks: RichBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "display" ? [] : block.spans.map((span) => (span.kind === "text" ? `${span.bold ? "b" : ""}${span.italic ? "i" : ""}:${span.text}` : "f")),
  );
}

describe("the client reads a rendering as the server check does", () => {
  it.each([
    ["Un mot **gras *et italique*** fin", [":Un mot ", "b:gras ", "bi:et italique", ": fin"]],
    ["**a *b***", ["b:a ", "bi:b"]],
    ["*a **b***", ["i:a ", "bi:b"]],
    ["x ***a* b**", [":x ", "bi:a", "b: b"]],
  ])("never shows a stray mark in %s", (rendering, expected) => {
    const blocks = parseRendering(rendering) ?? [];
    expect(clientText(blocks)).toBe(serverText(rendering));
    expect(styles(blocks).join("").includes("*")).toBe(false);
    expect(styles(blocks).map((span) => span.replace(/\s+/g, " "))).toEqual(expected);
  });

  it("shows exactly the words and signs the server compares, on thousands of random renderings", () => {
    const alphabet = ["a", "b", " ", " ", "\n", "\n\n", "*", "**", "***", "_", "# ", "- ", "1. ", "  - ", "é", "x1"];
    let seed = 20261026;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 4_000; round += 1) {
      const length = 1 + Math.floor(next() * 24);
      let rendering = "";
      for (let at = 0; at < length; at += 1) {
        rendering += alphabet[Math.floor(next() * alphabet.length)];
      }
      const blocks = parseRendering(rendering) ?? [];
      expect(clientText(blocks)).toBe(serverText(rendering));
    }
  });

  it("keeps the characters it uses as placeholders when the text holds them", () => {
    const rendering = "a0b $x$  et $y$";
    const blocks = parseRendering(rendering) ?? [];
    expect(clientText(blocks)).toBe(rendering);
  });
});

describe("the parser on hostile renderings", () => {
  const timed = (rendering: string) => {
    const started = Date.now();
    const blocks = parseRendering(rendering);
    return { blocks, elapsed: Date.now() - started };
  };

  it.each([
    ["marks that never close after many that do", "*a* ".repeat(5_000) + "**a ".repeat(2_500)],
    ["a tail of triple marks", "*a* ".repeat(5_000) + "***a ".repeat(2_000)],
    ["only opening marks", "**a ".repeat(15_000)],
    ["only single marks", "*a ".repeat(20_000)],
    ["only underscores", "_a ".repeat(20_000)],
    ["a very long line", "x".repeat(60_000)],
    ["many short items", "- a\n".repeat(15_000)],
    ["nested starts", "*".repeat(30_000) + "a" + "*".repeat(30_000)],
  ])("parses %s in a bounded time", (_name, rendering) => {
    const { blocks, elapsed } = timed(rendering.slice(0, 60_000));
    expect(blocks).not.toBeNull();
    expect(elapsed).toBeLessThan(1_500);
  });
});
