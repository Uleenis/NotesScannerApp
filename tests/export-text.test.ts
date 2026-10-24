import { escapeHtml, escapeMarkdown, exportFileName, MAX_FILE_NAME_LENGTH } from "@/export/text";

describe("escapeHtml", () => {
  test("turns the five characters of markup into entities", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  test("keeps every other character as it is", () => {
    expect(escapeHtml("Café — 3 × 4 = 12, œuvre")).toBe("Café — 3 × 4 = 12, œuvre");
  });

  test.each(["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "</style><script>x</script>", "&lt;script&gt;"])("leaves no tag in %s", (hostile) => {
    expect(escapeHtml(hostile)).not.toMatch(/[<>"']/);
  });
});

describe("escapeMarkdown", () => {
  test.each([
    ["emphasis and code", "a *b* _c_ `d`", "a \\*b\\* \\_c\\_ \\`d\\`"],
    ["links", "[x](y)", "\\[x\\](y)"],
    ["a backslash", "a\\b", "a\\\\b"],
    ["a dollar sign", "3 $ and $4", "3 \\$ and \\$4"],
    ["strikethrough and tables", "~a~ | b", "\\~a\\~ \\| b"],
    ["headings", "# a # b", "\\# a \\# b"],
  ])("escapes %s", (_, text, expected) => {
    expect(escapeMarkdown(text)).toBe(expected);
  });

  test("never lets raw HTML or an entity through", () => {
    const escaped = escapeMarkdown("<script>alert(1)</script> <img src=x onerror=1> &lt; &amp;");
    expect(escaped).not.toMatch(/(^|[^\\])[<>]/);
    expect(escaped).not.toMatch(/(^|[^\\])&/);
  });

  test.each([
    ["a dash", "- item", "\\- item"],
    ["a plus", "+ item", "\\+ item"],
    ["an ordered item", "1. item", "1\\. item"],
    ["an ordered item with a parenthesis", "12) item", "12\\) item"],
    ["an equals line", "===", "\\==="],
    ["an indented dash", "   - item", "\\- item"],
  ])("escapes the marker of %s at the start of a line", (_, text, expected) => {
    expect(escapeMarkdown(text)).toBe(expected);
  });

  test("keeps a dash, a plus and a number inside a line", () => {
    expect(escapeMarkdown("a - b + c 1. d")).toBe("a - b + c 1. d");
  });

  test("drops the indentation that would make a code block and the trailing spaces", () => {
    expect(escapeMarkdown("        indented  ")).toBe("indented");
  });

  test("keeps accents, quotes and punctuation as they are", () => {
    expect(escapeMarkdown("Mort -> 27/04/1521, « œuvre » (vers 1480) ?")).toBe("Mort -\\> 27/04/1521, « œuvre » (vers 1480) ?");
  });
});

describe("exportFileName", () => {
  test("keeps letters, digits, dots, dashes and underscores", () => {
    expect(exportFileName("Histoire_2026.v2-final", "notes")).toBe("Histoire_2026.v2-final");
  });

  test("replaces runs of anything else with one dash", () => {
    expect(exportFileName("Histoire de France / 1789 : la Révolution", "notes")).toBe("Histoire-de-France-1789-la-Révolution");
  });

  test.each([
    ["a path", "../../etc/passwd", "etc-passwd"],
    ["a hidden file", "...secret", "secret"],
    ["a Windows path", "C:\\Users\\x\\note", "C-Users-x-note"],
    ["a null byte", "note\u0000.pdf", "note-.pdf"],
    ["a right-to-left override", "note\u202Efdp.exe", "note-fdp.exe"],
    ["a newline", "note\n.sh", "note-.sh"],
  ])("reduces %s", (_, hostile, expected) => {
    expect(exportFileName(hostile, "notes")).toBe(expected);
  });

  test("falls back when nothing acceptable is left", () => {
    expect(exportFileName("///", "notes")).toBe("notes");
    expect(exportFileName("", "notes")).toBe("notes");
    expect(exportFileName("😀😀", "notes")).toBe("notes");
  });

  test("is at most 80 characters, counted by character", () => {
    expect(MAX_FILE_NAME_LENGTH).toBe(80);
    expect(exportFileName("a".repeat(200), "notes")).toBe("a".repeat(80));
    expect(Array.from(exportFileName("é".repeat(200), "notes"))).toHaveLength(80);
  });

  test("does not end on a dash or a dot after the cut", () => {
    expect(exportFileName(`${"a".repeat(79)} b`, "notes")).toBe("a".repeat(79));
  });

  test("never contains a character outside the allowed ones", () => {
    const name = exportFileName("a<b>c\"d|e?f*g:h\\i/j k\tl\u0007m", "notes");
    expect(name).toMatch(/^[\p{L}\p{N}._-]+$/u);
  });
});

describe("line terminators and links in a text", () => {
  test.each([
    ["a lone carriage return", "abc\rdef\r---\r- item"],
    ["a next-line character", "abc\u0085- item"],
    ["a line separator", "abc\u2028- item"],
    ["a paragraph separator", "abc\u2029# title"],
    ["a vertical tab and a form feed", "abc\v- item\f- item"],
  ])("never lets %s start a new line", (_, text) => {
    expect(escapeMarkdown(text)).not.toMatch(/[\r\n\u0085\u2028\u2029\v\f]/);
  });

  test("keeps the words of a text cut by a carriage return apart", () => {
    expect(escapeMarkdown("abc\rdef")).toBe("abc def");
  });

  test.each([
    ["an address", "voir https://evil.example/x", "voir https\\://evil.example/x"],
    ["a www address", "voir www.evil.example", "voir www\\.evil.example"],
    ["an e-mail address", "écrire à a@b.co", "écrire à a\\@b.co"],
  ])("breaks %s so a viewer does not link it", (_, text, expected) => {
    expect(escapeMarkdown(text)).toBe(expected);
  });

  test("keeps a time and a ratio as they are", () => {
    expect(escapeMarkdown("rdv à 12:30 et 3:1")).toBe("rdv à 12:30 et 3:1");
  });
});

describe("file names beyond the characters", () => {
  test("keeps the combining marks of scripts that need them", () => {
    expect(exportFileName("नमस्ते", "notes")).toBe("नमस्ते");
  });

  test("is at most 200 bytes", () => {
    const name = exportFileName("𝐀".repeat(100), "notes");
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(name.length).toBeGreaterThan(0);
  });
});
