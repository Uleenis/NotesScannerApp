import * as ts from "typescript";

import texts from "@/training/writing-test-texts.json";
import { faultsOfSheet, SHEET_LINES, sheetLines, templateFor, TRAINING_LINES, VALIDATION_LINES } from "@/training/writing-test";

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const REQUIRED = {
  fr: LETTERS + "éèêëàâäîïôöûùüÿçœæÉÈÊÀÂÎÔÇŒ" + ".,;:!?'\"«»()-+=/%€",
  en: LETTERS + ".,;:!?'\"()-+=/%&£$",
};

function count(text: string, char: string): number {
  return [...text].filter((one) => one === char).length;
}

describe.each(["fr", "en"] as const)("the %s writing test", (template) => {
  const lines = texts[template].lines;

  test("has forty lines of 35 to 45 characters", () => {
    expect(lines).toHaveLength(TRAINING_LINES + VALIDATION_LINES);
    expect(lines.filter((line) => [...line].length < 35 || [...line].length > 45)).toEqual([]);
  });

  test("carries each listed character at least twice in the training lines", () => {
    const training = lines.slice(0, TRAINING_LINES).join("\n");
    const missing = [...REQUIRED[template]].filter((char) => count(training, char) < 2);
    expect(missing).toEqual([]);
  });

  test("has eight deliberate faults in the ten validation lines, each written as it is in its line", () => {
    const faults = texts[template].faults;
    expect(faults).toHaveLength(8);
    expect(new Set(faults.map((fault) => fault.line)).size).toBe(8);
    for (const fault of faults) {
      expect(fault.line).toBeGreaterThan(TRAINING_LINES);
      expect(fault.line).toBeLessThanOrEqual(TRAINING_LINES + VALIDATION_LINES);
      expect(lines[fault.line - 1]).toContain(fault.written);
      expect(fault.correct).not.toBe(fault.written);
    }
  });

  test("has no line that is a blank or has a space at its edges", () => {
    expect(lines.filter((line) => line.trim() !== line || line.includes("  "))).toEqual([]);
  });
});

test("the sheets are the first and the last twenty lines", () => {
  expect(SHEET_LINES).toBe(20);
  expect(sheetLines("fr", 1)).toEqual(texts.fr.lines.slice(0, 20));
  expect(sheetLines("fr", 2)).toEqual(texts.fr.lines.slice(20));
  expect(sheetLines("en", 2)).toEqual(texts.en.lines.slice(20));
});

test("the faults of a sheet are the faults of its lines, numbered from 1 on the sheet", () => {
  expect(faultsOfSheet("fr", 1)).toEqual([]);
  const second = faultsOfSheet("fr", 2);
  expect(second).toHaveLength(8);
  expect(second.map((fault) => fault.line)).toEqual(texts.fr.faults.map((fault) => fault.line - 20));
});

test("the template follows the language of the interface", () => {
  expect(templateFor("fr")).toBe("fr");
  expect(templateFor("en")).toBe("en");
});

test("the copy of the reading service is the copy of the app", () => {
  const service = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/services/reading/src/reading/writing_test_texts.json`);
  expect(JSON.parse(service ?? "null")).toEqual(texts);
});
