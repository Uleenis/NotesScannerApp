import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

import type { BlockReason } from "@/capture/allowance";
import { field, isBlockReason, looksLikeNetworkFailure, refusalCode } from "@/capture/api";
import { parseMoment } from "./dates";

export type PageStatus = "queued" | "processing" | "read" | "failed";

export type QueueReason = "read_error" | "offline";

export type PageType = "text" | "math" | "unsupported_script";

export type SwitchableType = Exclude<PageType, "unsupported_script">;

export type PageRecord = {
  id: string;
  notebookId: string;
  status: PageStatus;
  queueReason: QueueReason | null;
  capturedAt: string;
  uploadedAt: string;
  attemptedAt: string | null;
  text: string | null;
  pageType: PageType;
};

export type NumberedPage = PageRecord & { number: number };

export type PagesClient = Pick<SupabaseClient, "from" | "functions" | "storage">;

export type StartResult =
  | { status: "read" }
  | { status: "queued" }
  | { status: "failed" }
  | { status: "limit"; reason: BlockReason }
  | { status: "photo" }
  | { status: "busy" }
  | { status: "tooSoon" }
  | { status: "missing" }
  | { status: "network" }
  | { status: "error" };

export type SetTypeResult = { status: "done"; pageType: SwitchableType } | { status: "refused" } | { status: "network" } | { status: "error" };

const PAGE_COLUMNS = "id, notebook_id, status, queue_reason, captured_at, uploaded_at, attempted_at, page_type, page_texts(text)";

const STATUSES: readonly string[] = ["queued", "processing", "read", "failed"];
const QUEUE_REASONS: readonly string[] = ["read_error", "offline"];
const PAGE_TYPES: readonly string[] = ["text", "math", "unsupported_script"];

const PHOTO_URL_SECONDS = 3600;

function readText(embedded: unknown): string | null {
  const first: unknown = Array.isArray(embedded) ? embedded[0] : embedded;
  const text = field(first, "text");
  return typeof text === "string" ? text : null;
}

function readPage(value: unknown): PageRecord {
  const id = field(value, "id");
  const notebookId = field(value, "notebook_id");
  const status = field(value, "status");
  const queueReason = field(value, "queue_reason") ?? null;
  const capturedAt = field(value, "captured_at");
  const uploadedAt = field(value, "uploaded_at");
  const attemptedAt = field(value, "attempted_at") ?? null;
  const pageType = field(value, "page_type");
  if (
    typeof id !== "string" ||
    typeof notebookId !== "string" ||
    typeof status !== "string" ||
    !STATUSES.includes(status) ||
    (queueReason !== null && (typeof queueReason !== "string" || !QUEUE_REASONS.includes(queueReason))) ||
    typeof capturedAt !== "string" ||
    typeof uploadedAt !== "string" ||
    (attemptedAt !== null && typeof attemptedAt !== "string") ||
    typeof pageType !== "string" ||
    !PAGE_TYPES.includes(pageType)
  ) {
    throw new Error("A page could not be read.");
  }
  return {
    id,
    notebookId,
    status: status as PageStatus,
    queueReason: queueReason as QueueReason | null,
    capturedAt,
    uploadedAt,
    attemptedAt,
    text: readText(field(value, "page_texts")),
    pageType: pageType as PageType,
  };
}

function byCapture(a: { id: string; capturedAt: string }, b: { id: string; capturedAt: string }): number {
  const difference = parseMoment(a.capturedAt) - parseMoment(b.capturedAt);
  if (difference !== 0 && !Number.isNaN(difference)) {
    return difference;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function numberPages(pages: PageRecord[]): NumberedPage[] {
  const counts = new Map<string, number>();
  return [...pages].sort(byCapture).map((page) => {
    const number = (counts.get(page.notebookId) ?? 0) + 1;
    counts.set(page.notebookId, number);
    return { ...page, number };
  });
}

export function newestFirst(pages: NumberedPage[]): NumberedPage[] {
  return [...pages].sort((a, b) => byCapture(b, a));
}

export async function listPages(client: PagesClient): Promise<NumberedPage[]> {
  const { data, error } = await client
    .from("pages")
    .select(PAGE_COLUMNS)
    .not("uploaded_at", "is", null)
    .order("captured_at", { ascending: true })
    .order("id");
  if (error || !Array.isArray(data)) {
    throw new Error("The pages could not be loaded.");
  }
  return numberPages(data.map(readPage));
}

export async function countPages(client: Pick<SupabaseClient, "from">): Promise<number> {
  const { count, error } = await client.from("pages").select("id", { count: "exact", head: true }).not("uploaded_at", "is", null);
  if (error || typeof count !== "number") {
    throw new Error("The pages could not be counted.");
  }
  return count;
}

export async function getPage(client: PagesClient, id: string): Promise<NumberedPage | null> {
  const found = await client.from("pages").select(PAGE_COLUMNS).eq("id", id).not("uploaded_at", "is", null).maybeSingle();
  if (found.error) {
    throw new Error("The page could not be loaded.");
  }
  if (found.data === null || found.data === undefined) {
    return null;
  }
  const page = readPage(found.data);

  const siblings = await client.from("pages").select("id, captured_at").eq("notebook_id", page.notebookId).not("uploaded_at", "is", null);
  if (siblings.error || !Array.isArray(siblings.data)) {
    throw new Error("The page could not be numbered.");
  }
  const earlier = siblings.data.filter((row) => {
    const otherId = field(row, "id");
    const otherCapturedAt = field(row, "captured_at");
    if (typeof otherId !== "string" || typeof otherCapturedAt !== "string") {
      throw new Error("The page could not be numbered.");
    }
    return byCapture({ id: otherId, capturedAt: otherCapturedAt }, page) < 0;
  });
  return { ...page, number: earlier.length + 1 };
}

export async function photoUrl(client: PagesClient, userId: string, pageId: string): Promise<string> {
  const { data, error } = await client.storage.from("photos").createSignedUrl(`${userId}/${pageId}/original.jpg`, PHOTO_URL_SECONDS);
  const url = field(data, "signedUrl");
  if (error || typeof url !== "string") {
    throw new Error("The photo could not be loaded.");
  }
  return url;
}

function startRefusal(code: string | null): StartResult {
  if (isBlockReason(code)) {
    return { status: "limit", reason: code };
  }
  switch (code) {
    case "page_processing":
    case "page_already_read":
      return { status: "busy" };
    case "photo_missing":
    case "photo_not_jpeg":
    case "photo_too_large":
      return { status: "photo" };
    case "relaunch_too_soon":
      return { status: "tooSoon" };
    case "page_not_found":
      return { status: "missing" };
    default:
      return { status: "error" };
  }
}

export async function startReading(client: PagesClient, pageId: string): Promise<StartResult> {
  try {
    const { data, error } = await client.functions.invoke("read-page", { body: { page_id: pageId } });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error instanceof FunctionsHttpError) {
      return startRefusal(await refusalCode(error));
    }
    const status = field(data, "status");
    if (error || (status !== "read" && status !== "queued" && status !== "failed")) {
      return { status: "error" };
    }
    return { status };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "error" };
  }
}

export async function setPageType(client: PagesClient, pageId: string, pageType: SwitchableType): Promise<SetTypeResult> {
  try {
    const { data, error } = await client.functions.invoke("set-page-type", { body: { page_id: pageId, page_type: pageType } });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error instanceof FunctionsHttpError) {
      return { status: "refused" };
    }
    if (error || field(data, "page_type") !== pageType) {
      return { status: "error" };
    }
    return { status: "done", pageType };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "error" };
  }
}
