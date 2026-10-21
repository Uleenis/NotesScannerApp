import { createClient, isAuthRetryableFetchError } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { UUID } from "./http.ts";
import type {
  AccountStore,
  Allowance,
  Auth,
  BlockReason,
  Bucket,
  CallerStore,
  ChargeReason,
  ChargeResult,
  ClaimExpectation,
  LibraryOutcome,
  LibraryStore,
  NotebookPage,
  PageReader,
  PageRow,
  PageStatus,
  PageTypeStore,
  PhotoInfo,
  QueueReason,
  ServerStore,
  SwitchOutcome,
  SweepStore,
  TransferStore,
} from "./ports.ts";

const BUCKET = "photos";

const PAGE_STATUSES: readonly string[] = ["queued", "processing", "read", "failed"];
const QUEUE_REASONS: readonly string[] = ["read_error", "offline"];
const BLOCK_REASONS: readonly string[] = ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"];
const CHARGE_REASONS: readonly string[] = ["charged", "already_charged", "page_not_found", ...BLOCK_REASONS];
const SWITCH_OUTCOMES: readonly string[] = ["switched", "unchanged", "page_not_found", "page_not_read", "unsupported_script", "no_reading"];

export class StoreError extends Error {
  constructor(operation: string) {
    super(operation);
    this.name = "StoreError";
  }
}

export type Keys = { url: string; publishableKey: string; secretKey: string };

type Row = Record<string, unknown>;

function dictionaryDefault(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.default === "string" ? parsed.default : undefined;
  } catch {
    return undefined;
  }
}

export function readKeys(get: (name: string) => string | undefined): Keys {
  const url = get("SUPABASE_URL");
  const publishableKey = dictionaryDefault(get("SUPABASE_PUBLISHABLE_KEYS")) ?? get("SUPABASE_ANON_KEY");
  const secretKey = dictionaryDefault(get("SUPABASE_SECRET_KEYS")) ?? get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) throw new StoreError("keys_missing");
  return { url, publishableKey, secretKey };
}

function isNotFound(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as Record<string, unknown>).statusCode : null;
  return String(code) === "404";
}

function isDuplicate(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as Record<string, unknown>).statusCode : null;
  return String(code) === "409";
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
}

function first(data: unknown): Row | null {
  return Array.isArray(data) ? row(data[0]) : row(data);
}

export function createAuth(keys: Keys, fetchImpl?: typeof fetch): Auth {
  const client = createClient(keys.url, keys.publishableKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    verify: async (token) => {
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) throw new StoreError("verify");
        return null;
      }
      return data.user ? { userId: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
    },
  };
}

function pageReader(client: SupabaseClient): PageReader {
  return {
    getPage: async (pageId): Promise<PageRow | null> => {
      const { data, error } = await client
        .from("pages")
        .select("id, user_id, status, queue_reason, retry_count, manual_relaunched_at")
        .eq("id", pageId)
        .maybeSingle();
      if (error) throw new StoreError("getPage");
      const found = row(data);
      if (!found || typeof found.id !== "string" || typeof found.user_id !== "string" || !PAGE_STATUSES.includes(String(found.status))) return null;
      const queueReason = found.queue_reason;
      if (queueReason !== null && !QUEUE_REASONS.includes(String(queueReason))) return null;
      if (!Number.isInteger(found.retry_count)) return null;
      const relaunchedAt = found.manual_relaunched_at;
      if (relaunchedAt !== null && typeof relaunchedAt !== "string") return null;
      return {
        id: found.id,
        userId: found.user_id,
        status: found.status as PageStatus,
        queueReason: queueReason as QueueReason | null,
        retryCount: found.retry_count as number,
        manualRelaunchedAt: relaunchedAt,
      };
    },
    photoInfo: async (path): Promise<PhotoInfo | null> => {
      const { data, error } = await client.storage.from(BUCKET).info(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw new StoreError("photoInfo");
      }
      if (!data) return null;
      return { size: typeof data.size === "number" ? data.size : Number.MAX_SAFE_INTEGER, mimeType: typeof data.contentType === "string" ? data.contentType : null };
    },
    downloadPhoto: async (path): Promise<Uint8Array | null> => {
      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw new StoreError("downloadPhoto");
      }
      if (!data) throw new StoreError("downloadPhoto");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

export function createServiceReader(keys: Keys, fetchImpl?: typeof fetch): PageReader {
  return pageReader(createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } }));
}

export function createCallerStore(keys: Keys, token: string, fetchImpl?: typeof fetch): CallerStore {
  const client: SupabaseClient = createClient(keys.url, keys.publishableKey, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchImpl },
  });
  return {
    ...pageReader(client),
    allowance: async (): Promise<Allowance | null> => {
      const { data, error } = await client.rpc("my_page_allowance");
      if (error) throw new StoreError("allowance");
      const found = first(data);
      if (!found) return null;
      const blocked = found.blocked_reason;
      return {
        isAnonymous: found.is_anonymous === true,
        used: Number(found.used),
        max: Number(found.max),
        remaining: Number(found.remaining),
        resetsAt: typeof found.resets_at === "string" ? found.resets_at : null,
        blockedReason: typeof blocked === "string" && BLOCK_REASONS.includes(blocked) ? blocked as BlockReason : null,
      };
    },
  };
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

async function listFiles(client: SupabaseClient, bucket: Bucket, root: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [root];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (let offset = 0;; offset += LIST_PAGE_SIZE) {
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: LIST_PAGE_SIZE, offset });
      if (error || !Array.isArray(data)) throw new StoreError("listFiles");
      for (const entry of data) {
        if (typeof entry.name !== "string") throw new StoreError("listFiles");
        if (entry.id === null) folders.push(`${folder}/${entry.name}`);
        else files.push(`${folder}/${entry.name}`);
      }
      if (data.length < LIST_PAGE_SIZE) break;
    }
  }
  return files;
}

export function createAccountStore(keys: Keys, fetchImpl?: typeof fetch): AccountStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    removeFiles: async (bucket, userId) => {
      const files = await listFiles(client, bucket, userId);
      for (let start = 0; start < files.length; start += REMOVE_BATCH_SIZE) {
        const { error } = await client.storage.from(bucket).remove(files.slice(start, start + REMOVE_BATCH_SIZE));
        if (error) throw new StoreError("removeFiles");
      }
      if ((await listFiles(client, bucket, userId)).length > 0) throw new StoreError("filesRemain");
    },
    deleteUser: async (userId) => {
      const { error } = await client.auth.admin.deleteUser(userId, false);
      if (error) throw new StoreError("deleteUser");
    },
  };
}

export function createTransferStore(keys: Keys, fetchImpl?: typeof fetch): TransferStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    hasProcessingPage: async (userId) => {
      const { data, error } = await client.from("pages").select("id").eq("user_id", userId).eq("status", "processing").limit(1);
      if (error || !Array.isArray(data)) throw new StoreError("hasProcessingPage");
      return data.length > 0;
    },
    listFiles: (bucket, userId) => listFiles(client, bucket, userId),
    copyFile: async (bucket, from, to) => {
      const { error } = await client.storage.from(bucket).copy(from, to);
      if (error && !isDuplicate(error)) throw new StoreError("copyFile");
    },
    moveRows: async (fromId, toId) => {
      const { data, error } = await client.rpc("transfer_account_rows", { p_from: fromId, p_to: toId });
      if (error) {
        if (error.message === "page_processing") return { ok: false, reason: "page_processing" };
        throw new StoreError("moveRows");
      }
      const found = first(data);
      if (!found || !Number.isInteger(found.pages) || !Number.isInteger(found.notebooks_merged)) throw new StoreError("moveRows");
      return { ok: true, pages: found.pages as number, notebooksMerged: found.notebooks_merged as number };
    },
  };
}

export function createServerStore(keys: Keys, fetchImpl?: typeof fetch): ServerStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    charge: async (pageId): Promise<ChargeResult> => {
      const { data, error } = await client.rpc("charge_page", { p_page_id: pageId });
      if (error) throw new StoreError("charge");
      const found = first(data);
      const reason = found?.reason;
      if (!found || typeof reason !== "string" || !CHARGE_REASONS.includes(reason)) throw new StoreError("charge");
      return { allowed: found.allowed === true, reason: reason as ChargeReason };
    },
    recordOriginalImage: async (userId, pageId, path) => {
      const { error } = await client
        .from("page_images")
        .upsert({ user_id: userId, page_id: pageId, kind: "original", storage_path: path }, { onConflict: "storage_path", ignoreDuplicates: true });
      if (error) throw new StoreError("recordOriginalImage");
    },
    claimForReading: async (userId, pageId, expected: ClaimExpectation) => {
      const claim = client
        .from("pages")
        .update({ status: "processing", queue_reason: null })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", expected.status)
        .eq("retry_count", expected.retryCount);
      const guarded = expected.status === "failed"
        ? claim.or(`manual_relaunched_at.is.null,manual_relaunched_at.lte.${expected.relaunchedBefore}`)
        : expected.queueReason === null
        ? claim.is("queue_reason", null)
        : claim.eq("queue_reason", expected.queueReason);
      const { data, error } = await guarded.select("id");
      if (error) throw new StoreError("claimForReading");
      return Array.isArray(data) && data.length === 1;
    },
    insertReading: async (userId, pageId, reading) => {
      const { error } = await client.from("readings").insert({
        user_id: userId,
        page_id: pageId,
        label: reading.label,
        raw_text: reading.rawText,
        model: reading.model,
        model_version: reading.modelVersion,
        prompt_version: reading.promptVersion,
        thinking_budget: reading.thinkingBudget,
        input_tokens: reading.inputTokens,
        output_tokens: reading.outputTokens,
        duration_ms: reading.durationMs,
      });
      if (error) throw new StoreError("insertReading");
    },
    upsertPageText: async (userId, pageId, text, pipelineVersion) => {
      const { error } = await client
        .from("page_texts")
        .upsert({ page_id: pageId, user_id: userId, text, pipeline_version: pipelineVersion }, { onConflict: "page_id" });
      if (error) throw new StoreError("upsertPageText");
    },
    markRead: async (userId, pageId, readAt, pageType) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "read", read_at: readAt, queue_reason: null, page_type: pageType })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "processing")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("markRead");
    },
    releaseToQueue: async (userId, pageId, reason, retryCount) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "queued", queue_reason: reason, retry_count: retryCount })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "processing")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("releaseToQueue");
    },
    markFailed: async (userId, pageId, retryCount) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "failed", queue_reason: null, retry_count: retryCount })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "processing")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("markFailed");
    },
    abandonQueued: async (userId, pageId) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "failed", queue_reason: null })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "queued")
        .eq("queue_reason", "read_error")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("abandonQueued");
    },
    createUploadUrl: async (path) => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new StoreError("createUploadUrl");
      return { signedUrl: data.signedUrl, token: data.token };
    },
  };
}

const LIBRARY_OUTCOMES: readonly string[] = ["deleted", "moved", "unchanged", "page_not_found", "chapter_not_found", "notebook_not_found", "page_processing"];
const NOTEBOOK_PAGES_SIZE = 1000;

function outcomeOf(data: unknown, operation: string): LibraryOutcome {
  const outcome = first(data)?.outcome;
  if (typeof outcome !== "string" || !LIBRARY_OUTCOMES.includes(outcome)) throw new StoreError(operation);
  return outcome as LibraryOutcome;
}

export function createLibraryStore(keys: Keys, fetchImpl?: typeof fetch): LibraryStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    pageStatus: async (userId, pageId) => {
      const { data, error } = await client.from("pages").select("status").eq("id", pageId).eq("user_id", userId).maybeSingle();
      if (error) throw new StoreError("pageStatus");
      const found = row(data);
      if (!found) return null;
      if (!PAGE_STATUSES.includes(String(found.status))) throw new StoreError("pageStatus");
      return found.status as PageStatus;
    },
    notebookPages: async (userId, notebookId) => {
      const notebook = await client.from("notebooks").select("id").eq("id", notebookId).eq("user_id", userId).maybeSingle();
      if (notebook.error) throw new StoreError("notebookPages");
      if (!row(notebook.data)) return null;
      const pages: NotebookPage[] = [];
      for (let offset = 0;; offset += NOTEBOOK_PAGES_SIZE) {
        const { data, error } = await client
          .from("pages")
          .select("id, status")
          .eq("notebook_id", notebookId)
          .eq("user_id", userId)
          .order("id")
          .range(offset, offset + NOTEBOOK_PAGES_SIZE - 1);
        if (error || !Array.isArray(data)) throw new StoreError("notebookPages");
        for (const entry of data) {
          const found = row(entry);
          if (!found || typeof found.id !== "string" || !PAGE_STATUSES.includes(String(found.status))) throw new StoreError("notebookPages");
          pages.push({ id: found.id, status: found.status as PageStatus });
        }
        if (data.length < NOTEBOOK_PAGES_SIZE) break;
      }
      return pages;
    },
    removePageFiles: async (bucket, userId, pageId) => {
      const folder = `${userId}/${pageId}`;
      const files = await listFiles(client, bucket, folder);
      if (files.length === 0) return;
      for (let start = 0; start < files.length; start += REMOVE_BATCH_SIZE) {
        const { error } = await client.storage.from(bucket).remove(files.slice(start, start + REMOVE_BATCH_SIZE));
        if (error) throw new StoreError("removePageFiles");
      }
      if ((await listFiles(client, bucket, folder)).length > 0) throw new StoreError("filesRemain");
    },
    deletePage: async (userId, pageId) => {
      const { data, error } = await client.rpc("delete_page", { p_page_id: pageId, p_user_id: userId });
      if (error) throw new StoreError("deletePage");
      return outcomeOf(data, "deletePage");
    },
    deleteChapter: async (userId, chapterId) => {
      const { data, error } = await client.rpc("delete_chapter", { p_chapter_id: chapterId, p_user_id: userId });
      if (error) throw new StoreError("deleteChapter");
      return outcomeOf(data, "deleteChapter");
    },
    deleteNotebook: async (userId, notebookId) => {
      const { data, error } = await client.rpc("delete_notebook", { p_notebook_id: notebookId, p_user_id: userId });
      if (error) throw new StoreError("deleteNotebook");
      const outcome = outcomeOf(data, "deleteNotebook");
      const ids = first(data)?.page_ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !UUID.test(id))) throw new StoreError("deleteNotebook");
      return { outcome, pageIds: ids as string[] };
    },
    movePage: async (userId, pageId, notebookId, chapterId) => {
      const { data, error } = await client.rpc("move_page", { p_page_id: pageId, p_user_id: userId, p_notebook_id: notebookId, p_chapter_id: chapterId });
      if (error) throw new StoreError("movePage");
      return outcomeOf(data, "movePage");
    },
  };
}

function switched(data: unknown, operation: string, field: "alto_path" | "b1"): { outcome: SwitchOutcome; value: string | null } {
  const found = first(data);
  const outcome = found?.outcome;
  if (!found || typeof outcome !== "string" || !SWITCH_OUTCOMES.includes(outcome) || !(field in found)) throw new StoreError(operation);
  const value = found[field];
  if (value !== null && typeof value !== "string") throw new StoreError(operation);
  return { outcome: outcome as SwitchOutcome, value };
}

async function storedSecond(client: SupabaseClient, userId: string, pageId: string): Promise<string | null> {
  try {
    const stored = await client.from("readings").select("raw_text").eq("page_id", pageId).eq("user_id", userId).eq("label", "B2");
    if (stored.error || !Array.isArray(stored.data) || stored.data.length !== 1) return null;
    const text = row(stored.data[0])?.raw_text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

export function createPageTypeStore(keys: Keys, fetchImpl?: typeof fetch): PageTypeStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    setMath: async (userId, pageId) => {
      const { data, error } = await client.rpc("set_page_math", { p_page_id: pageId, p_user_id: userId });
      if (error) throw new StoreError("setMath");
      const { outcome, value } = switched(data, "setMath", "alto_path");
      return { outcome, altoPath: value };
    },
    setText: async (userId, pageId, readAgain) => {
      const { data, error } = await client.rpc("set_page_text", { p_page_id: pageId, p_user_id: userId, p_read_again: readAgain });
      if (error) throw new StoreError("setText");
      const { outcome, value } = switched(data, "setText", "b1");
      if (value === null) return { outcome, b1: null, b2: null };
      return { outcome, b1: value, b2: await storedSecond(client, userId, pageId) };
    },
    removeAlto: async (path) => {
      const { error } = await client.storage.from("alto").remove([path]);
      if (error) throw new StoreError("removeAlto");
    },
  };
}

const ALTO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function createSweepStore(keys: Keys, fetchImpl?: typeof fetch): SweepStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    orphans: async (limit) => {
      const { data, error } = await client.rpc("alto_orphans", { p_limit: limit });
      if (error || !Array.isArray(data)) throw new StoreError("altoOrphans");
      return data.map((entry) => {
        const name = row(entry)?.name;
        if (typeof name !== "string" || !ALTO_PATH.test(name)) throw new StoreError("altoOrphans");
        return name;
      });
    },
    remove: async (paths) => {
      let removed = 0;
      for (let start = 0; start < paths.length; start += REMOVE_BATCH_SIZE) {
        const { data, error } = await client.storage.from("alto").remove(paths.slice(start, start + REMOVE_BATCH_SIZE));
        if (error || !Array.isArray(data)) throw new StoreError("removeAlto");
        removed += data.length;
      }
      return removed;
    },
  };
}