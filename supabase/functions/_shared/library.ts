import { refuse, UUID } from "./http.ts";
import type { Logger } from "./log.ts";
import type { LibraryOutcome, LibraryStore, NotebookPage } from "./ports.ts";
import type { Refusal } from "./refusals.ts";

export type Field = { name: string; nullable?: boolean };

const REFUSALS: Record<Exclude<LibraryOutcome, "deleted" | "moved" | "unchanged">, Refusal> = {
  page_not_found: { status: 404, code: "page_not_found" },
  chapter_not_found: { status: 404, code: "chapter_not_found" },
  notebook_not_found: { status: 404, code: "notebook_not_found" },
  page_processing: { status: 409, code: "page_processing" },
};

const FOLDER_BATCH_SIZE = 8;

export async function idsFrom(request: Request, fields: readonly Field[]): Promise<Record<string, string | null> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const given = body as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.length !== fields.length || keys.some((key) => !fields.some((field) => field.name === key))) return null;
  const ids: Record<string, string | null> = {};
  for (const field of fields) {
    const value = given[field.name];
    if (value === null && field.nullable) ids[field.name] = null;
    else if (typeof value === "string" && UUID.test(value)) ids[field.name] = value.toLowerCase();
    else return null;
  }
  return ids;
}

export function refuseOutcome(log: Logger, outcome: Exclude<LibraryOutcome, "deleted" | "moved" | "unchanged">, pageId?: string): Response {
  return refuse(log, REFUSALS[outcome], pageId);
}

export function refusalOutcome(outcome: LibraryOutcome): outcome is Exclude<LibraryOutcome, "deleted" | "moved" | "unchanged"> {
  return outcome !== "deleted" && outcome !== "moved" && outcome !== "unchanged";
}

export async function removeFolders(
  library: LibraryStore,
  buckets: readonly ("photos" | "alto")[],
  userId: string,
  pages: readonly Pick<NotebookPage, "id">[],
): Promise<void> {
  for (const bucket of buckets) {
    for (let start = 0; start < pages.length; start += FOLDER_BATCH_SIZE) {
      await Promise.all(pages.slice(start, start + FOLDER_BATCH_SIZE).map((page) => library.removePageFiles(bucket, userId, page.id)));
    }
  }
}
