import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

import type { Allowance, BlockReason } from "./allowance";
import type { CreatePageResult, MarkResult, PrepareResult, UploadResult } from "./send-page";

export type CaptureClient = Pick<SupabaseClient, "from" | "rpc" | "functions" | "storage">;

const BLOCK_REASONS: readonly string[] = ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"];

const NETWORK_MESSAGE = /network|fetch|timed? ?out|offline|connection/i;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type PhotoFile = { bytes: () => Promise<Uint8Array>; delete: () => void };

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && BLOCK_REASONS.includes(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

export function parseAllowance(data: unknown): Allowance | null {
  const found: unknown = Array.isArray(data) ? data[0] : data;
  const used = readNumber(field(found, "used"));
  const max = readNumber(field(found, "max"));
  const remaining = readNumber(field(found, "remaining"));
  if (used === null || max === null || remaining === null) {
    return null;
  }
  const resetsAt = field(found, "resets_at");
  const blocked = field(found, "blocked_reason");
  return {
    isAnonymous: field(found, "is_anonymous") === true,
    used,
    max,
    remaining,
    resetsAt: typeof resetsAt === "string" ? resetsAt : null,
    blockedReason: isBlockReason(blocked) ? blocked : null,
  };
}

export function looksLikeNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  const code = field(error, "code");
  const statusCode = field(error, "statusCode");
  const message = field(error, "message");
  return (code === undefined || code === "") && statusCode === undefined && typeof message === "string" && NETWORK_MESSAGE.test(message);
}

export async function fetchAllowance(client: CaptureClient): Promise<Allowance | null> {
  const { data, error } = await client.rpc("my_page_allowance");
  if (error) {
    throw new Error("The allowance could not be loaded.");
  }
  return parseAllowance(data);
}

export async function fetchLatestNotebookId(client: CaptureClient): Promise<string | null> {
  const { data, error } = await client
    .from("pages")
    .select("notebook_id")
    .not("uploaded_at", "is", null)
    .order("captured_at", { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data)) {
    throw new Error("The last notebook could not be loaded.");
  }
  const id = field(data[0], "notebook_id");
  return typeof id === "string" ? id : null;
}

export async function insertPage(
  client: CaptureClient,
  notebookId: string,
  capturedAt: string,
  chapterId: string | null,
): Promise<CreatePageResult> {
  try {
    const row: Record<string, string> = { notebook_id: notebookId, source: "camera", captured_at: capturedAt };
    const { data, error } = await client
      .from("pages")
      .insert(chapterId === null ? row : { ...row, chapter_id: chapterId })
      .select("id")
      .single();
    const id = field(data, "id");
    if (error || typeof id !== "string") {
      return { status: looksLikeNetworkFailure(error) ? "network" : "failed" };
    }
    return { status: "created", pageId: id };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "failed" };
  }
}

export async function markUploaded(client: CaptureClient, pageId: string, uploadedAt: string): Promise<MarkResult> {
  try {
    const { error } = await client.from("pages").update({ uploaded_at: uploadedAt }).eq("id", pageId);
    if (!error) {
      return "marked";
    }
    return looksLikeNetworkFailure(error) ? "network" : "failed";
  } catch (error) {
    return looksLikeNetworkFailure(error) ? "network" : "failed";
  }
}

export async function refusalCode(error: FunctionsHttpError): Promise<string | null> {
  try {
    const body: unknown = await error.context.json();
    const code = field(body, "error");
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function prepareRefusal(code: string | null): PrepareResult {
  if (isBlockReason(code)) {
    return { status: "limit", reason: code };
  }
  switch (code) {
    case "photo_exists":
      return { status: "exists" };
    case "page_processing":
      return { status: "processing" };
    case "page_already_read":
      return { status: "read" };
    default:
      return { status: "failed" };
  }
}

export async function callPrepare(client: CaptureClient, pageId: string): Promise<PrepareResult> {
  try {
    const { data, error } = await client.functions.invoke("prepare-page", { body: { page_id: pageId } });
    if (error instanceof FunctionsFetchError) {
      return { status: "network" };
    }
    if (error instanceof FunctionsHttpError) {
      return prepareRefusal(await refusalCode(error));
    }
    const path = field(data, "path");
    const token = field(data, "token");
    if (error || typeof path !== "string" || typeof token !== "string") {
      return { status: "failed" };
    }
    return { status: "ready", path, token };
  } catch (error) {
    return { status: looksLikeNetworkFailure(error) ? "network" : "failed" };
  }
}

export async function callRead(client: CaptureClient, pageId: string): Promise<void> {
  try {
    await client.functions.invoke("read-page", { body: { page_id: pageId } });
  } catch {
    return;
  }
}

export async function uploadPhoto(client: CaptureClient, path: string, token: string, bytes: Uint8Array): Promise<UploadResult> {
  if (bytes.length > MAX_PHOTO_BYTES) {
    return "tooLarge";
  }
  try {
    const { error } = await client.storage.from("photos").uploadToSignedUrl(path, token, bytes, { contentType: "image/jpeg" });
    if (!error) {
      return "uploaded";
    }
    const statusCode = String(field(error, "statusCode") ?? "");
    if (statusCode === "413") {
      return "tooLarge";
    }
    if (statusCode === "415") {
      return "refused";
    }
    return looksLikeNetworkFailure(error) ? "network" : "failed";
  } catch (error) {
    return looksLikeNetworkFailure(error) ? "network" : "failed";
  }
}

function discard(file: PhotoFile): void {
  try {
    file.delete();
  } catch {
    return;
  }
}

export async function uploadPhotoFile(client: CaptureClient, file: PhotoFile, path: string, token: string): Promise<UploadResult> {
  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch {
    return "failed";
  }
  const result = await uploadPhoto(client, path, token, bytes);
  if (result === "uploaded") {
    discard(file);
  }
  return result;
}
