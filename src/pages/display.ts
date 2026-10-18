export type DisplayBlock = { kind: "line"; text: string } | { kind: "gap" };

export type DisplayDocument = { title: string | null; blocks: DisplayBlock[] };

const OPENING_MARKS = /^[\s([«"'“‘]+/u;
const LIST_ITEM_START = /^\s*(?:[-–—•*·▪●◦]|[\p{L}\p{N}]{1,2}[).]\s)/u;
const LATEX = /\$|\\\p{L}+/u;
const JOINING_END = /(?:->|→|=>|⇒|,|:|[-–—])\s*$/u;
const LOWERCASE_START = /^\p{Ll}/u;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

export function pageTitle(text: string): string | null {
  const first = splitLines(text).find((line) => !isBlank(line));
  return first === undefined ? null : first.trim();
}

export function joinsPrevious(previous: string, line: string): boolean {
  if (isBlank(previous) || isBlank(line)) {
    return false;
  }
  if (LIST_ITEM_START.test(line) || LATEX.test(previous) || LATEX.test(line)) {
    return false;
  }
  return LOWERCASE_START.test(line.replace(OPENING_MARKS, "")) || JOINING_END.test(previous);
}

function glue(previous: string, line: string): string {
  const spaced = /\s$/u.test(previous) || /^\s/u.test(line);
  return spaced ? previous + line : `${previous} ${line}`;
}

export function documentBody(text: string): string {
  const lines = splitLines(text);
  const titleIndex = lines.findIndex((line) => !isBlank(line));
  return titleIndex === -1 ? "" : lines.slice(titleIndex + 1).join("\n");
}

export function displayDocument(text: string): DisplayDocument {
  const lines = splitLines(text);
  const titleIndex = lines.findIndex((line) => !isBlank(line));
  if (titleIndex === -1) {
    return { title: null, blocks: [] };
  }

  const blocks: DisplayBlock[] = [];
  let previousLine = "";
  for (const line of lines.slice(titleIndex + 1)) {
    const last = blocks[blocks.length - 1];
    if (isBlank(line)) {
      if (last !== undefined && last.kind === "line") {
        blocks.push({ kind: "gap" });
      }
    } else if (last !== undefined && last.kind === "line" && joinsPrevious(previousLine, line)) {
      blocks[blocks.length - 1] = { kind: "line", text: glue(last.text, line) };
    } else {
      blocks.push({ kind: "line", text: line });
    }
    previousLine = line;
  }
  if (blocks[blocks.length - 1]?.kind === "gap") {
    blocks.pop();
  }

  return { title: lines[titleIndex].trim(), blocks };
}
