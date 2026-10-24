import { buildDocument, planPage } from "@/export/document";
import { formulaKey, toHtml } from "@/export/html";
import { renderTex, type DrawnTex } from "@/pages/tex";
import type { NumberedPage } from "@/pages/pages";

jest.setTimeout(30_000);

function mathPage(text: string): NumberedPage {
  return {
    id: "page-1",
    notebookId: "notebook-1",
    chapterId: null,
    status: "read",
    queueReason: null,
    capturedAt: "2026-09-26T14:32:00.000Z",
    uploadedAt: "2026-09-26T14:32:05.000Z",
    attemptedAt: null,
    text,
    pageType: "math",
    number: 1,
  };
}

test("a formula drawn by the real engine becomes a self-contained image of the page", async () => {
  const drawn = await renderTex("\\frac{a}{b} + x^2", false);
  expect(drawn).not.toBeNull();
  expect(drawn).not.toBeUndefined();
  const picture = drawn as DrawnTex;

  const document = buildDocument(planPage("Suites", mathPage("Suites\nSoit $\\frac{a}{b} + x^2$ ici")), new Map(), (number) => `Page ${number}`);
  const html = toHtml(document, new Map([[formulaKey("\\frac{a}{b} + x^2", false), picture]]), "en");

  const source = /<img alt="" src="data:image\/svg\+xml;utf8,([^"]*)"/.exec(html)?.[1];
  expect(source).toBeDefined();
  const svg = decodeURIComponent(source ?? "");
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toBe(picture.svg);
  expect(html).toContain("Soit ");
  expect(html).not.toContain("<code>");
});
