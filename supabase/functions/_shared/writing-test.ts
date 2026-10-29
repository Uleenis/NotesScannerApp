export const WRITING_TEMPLATES = ["fr", "en"] as const;

export type WritingTemplate = (typeof WRITING_TEMPLATES)[number];

export const SHEETS = [1, 2] as const;

export type Sheet = (typeof SHEETS)[number];

export function isTemplate(value: unknown): value is WritingTemplate {
  return typeof value === "string" && (WRITING_TEMPLATES as readonly string[]).includes(value);
}

export function sheetPath(userId: string, testId: string, sheet: Sheet): string {
  return `${userId}/writing-tests/${testId}/${sheet}.jpg`;
}
