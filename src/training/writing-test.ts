import type { Language } from "@/i18n";
import texts from "./writing-test-texts.json";

export type Template = "fr" | "en";

export type Sheet = 1 | 2;

export type Fault = { line: number; written: string; correct: string };

export const SHEETS: readonly Sheet[] = [1, 2];

export const SHEET_LINES = 20;
export const TRAINING_LINES = 30;
export const VALIDATION_LINES = 10;

export function templateFor(language: Language): Template {
  return language === "fr" ? "fr" : "en";
}

export function sheetLines(template: Template, sheet: Sheet): readonly string[] {
  return texts[template].lines.slice((sheet - 1) * SHEET_LINES, sheet * SHEET_LINES);
}

export function faultsOfSheet(template: Template, sheet: Sheet): Fault[] {
  const first = (sheet - 1) * SHEET_LINES;
  return texts[template].faults
    .filter((fault) => fault.line > first && fault.line <= first + SHEET_LINES)
    .map((fault) => ({ ...fault, line: fault.line - first }));
}
