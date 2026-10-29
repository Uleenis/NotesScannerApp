import { createClient, isAuthRetryableFetchError } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { UUID } from "./http.ts";
import type { PageType } from "./page-type.ts";
import type {
  AccountStore,
  Allowance,
  Auth,
  BlockReason,
  Bucket,
  CallerStore,
  ChargeReason,
  ChargeResult,
  ClaimedTask,
  ClaimExpectation,
  EditOutcome,
  EditStore,
  LibraryOutcome,
  LibraryStore,
  MathAlertOutcome,
  MathCheckStore,
  NotebookPage,
  PageReader,
  PageRow,
  PageStatus,
  PageTypeStore,
  ParentConfirmOutcome,
  ParentConsentStore,
  ParentRequestOutcome,
  PhotoInfo,
  QueueReason,
  RenderStore,
  RevokeStore,
  ServerStore,
  SwitchOutcome,
  SweepKind,
  SweepStore,
  TrainingBucket,
  TrainingPage,
  TrainingReport,
  TrainingStore,
  TransferStore,
  UploadOutcome,
  ReportOutcome,
  WritingBegin,
  WritingFinish,
  WritingTestStore,
} from "./ports.ts";
import { isTemplate } from "./writing-test.ts";

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

async function removeFolder(client: SupabaseClient, bucket: Bucket, folder: string): Promise<void> {
  const files = await listFiles(client, bucket, folder);
  for (let start = 0; start < files.length; start += REMOVE_BATCH_SIZE) {
    const { error } = await client.storage.from(bucket).remove(files.slice(start, start + REMOVE_BATCH_SIZE));
    if (error) throw new StoreError("removeFiles");
  }
  if ((await listFiles(client, bucket, folder)).length > 0) throw new StoreError("filesRemain");
}

export function createAccountStore(keys: Keys, fetchImpl?: typeof fetch): AccountStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    removeFiles: (bucket, userId) => removeFolder(client, bucket, userId),
    deleteUser: async (userId) => {
      const { error } = await client.auth.admin.deleteUser(userId, false);
      if (error) throw new StoreError("deleteUser");
    },
  };
}

export function createRevokeStore(keys: Keys, fetchImpl?: typeof fetch): RevokeStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    removeFiles: async (userId) => {
      await removeFolder(client, "models", userId);
      await removeFolder(client, "photos", `${userId}/writing-tests`);
    },
    revoke: async (userId) => {
      const { data, error } = await client.rpc("revoke_training", { p_user_id: userId });
      if (error || typeof data !== "boolean") throw new StoreError("revokeTraining");
      return data;
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

const MATH_ALERT_OUTCOMES: readonly string[] = ["recorded", "page_not_found", "not_math", "no_readings"];

function mathChecks(client: SupabaseClient): MathCheckStore {
  return {
    mathCheckReadings: async (userId, pageId) => {
      const { data, error } = await client.rpc("math_check_readings", { p_page_id: pageId, p_user_id: userId });
      if (error || !Array.isArray(data) || data.length > 1) throw new StoreError("mathCheckReadings");
      const found = first(data);
      if (!found) return null;
      if (typeof found.b1 !== "string" || typeof found.b2 !== "string") throw new StoreError("mathCheckReadings");
      return { b1: found.b1, b2: found.b2 };
    },
    recordMathAlert: async (userId, pageId, onlyB1, onlyB2) => {
      const { data, error } = await client.rpc("record_math_alert", { p_page_id: pageId, p_user_id: userId, p_only_b1: onlyB1, p_only_b2: onlyB2 });
      if (error || typeof data !== "string" || !MATH_ALERT_OUTCOMES.includes(data)) throw new StoreError("recordMathAlert");
      return data as MathAlertOutcome;
    },
  };
}

export function createServerStore(keys: Keys, fetchImpl?: typeof fetch): ServerStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    ...mathChecks(client),
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

const EDIT_OUTCOMES: readonly string[] = ["edited", "page_not_found", "page_not_read", "unsupported_script", "not_editable", "text_mismatch", "invalid_edit"];

export function createEditStore(keys: Keys, fetchImpl?: typeof fetch): EditStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    editPage: async (userId, pageId, text, words, gaps) => {
      const { data, error } = await client.rpc("edit_page", { p_page_id: pageId, p_user_id: userId, p_text: text, p_words: words, p_gaps: gaps });
      if (error) throw new StoreError("editPage");
      if (typeof data !== "string" || !EDIT_OUTCOMES.includes(data)) throw new StoreError("editPage");
      return data as EditOutcome;
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
    ...mathChecks(client),
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

const SWEEPS: Record<SweepKind, { rpc: string; bucket: Bucket; name: RegExp }> = {
  alto: { rpc: "alto_orphans", bucket: "alto", name: ALTO_PATH },
  models: {
    rpc: "model_orphans",
    bucket: "models",
    name: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.safetensors$/,
  },
  writingTests: {
    rpc: "writing_test_orphans",
    bucket: "photos",
    name: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/writing-tests\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[12]\.jpg$/,
  },
};

export function createSweepStore(keys: Keys, kind: SweepKind = "alto", fetchImpl?: typeof fetch): SweepStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  const sweep = SWEEPS[kind];
  return {
    orphans: async (limit) => {
      const { data, error } = await client.rpc(sweep.rpc, { p_limit: limit });
      if (error || !Array.isArray(data)) throw new StoreError("orphans");
      return data.map((entry) => {
        const name = row(entry)?.name;
        if (typeof name !== "string" || !sweep.name.test(name)) throw new StoreError("orphans");
        return name;
      });
    },
    remove: async (paths) => {
      if (!paths.every((path) => sweep.name.test(path))) throw new StoreError("removeOrphans");
      let removed = 0;
      for (let start = 0; start < paths.length; start += REMOVE_BATCH_SIZE) {
        const { data, error } = await client.storage.from(sweep.bucket).remove(paths.slice(start, start + REMOVE_BATCH_SIZE));
        if (error || !Array.isArray(data)) throw new StoreError("removeOrphans");
        removed += data.length;
      }
      return removed;
    },
  };
}

const PAGE_TYPES: readonly string[] = ["text", "math", "unsupported_script"];

export function createRenderStore(keys: Keys, fetchImpl?: typeof fetch): RenderStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    page: async (userId, pageId) => {
      const page = await client.from("pages").select("status, page_type").eq("id", pageId).eq("user_id", userId).maybeSingle();
      if (page.error) throw new StoreError("renderPage");
      const found = row(page.data);
      if (!found) return null;
      if (!PAGE_STATUSES.includes(String(found.status)) || !PAGE_TYPES.includes(String(found.page_type))) throw new StoreError("renderPage");
      const [texts, renderings] = await Promise.all([
        client.from("page_texts").select("text").eq("page_id", pageId).eq("user_id", userId).maybeSingle(),
        client.from("page_renderings").select("text, based_on").eq("page_id", pageId).eq("user_id", userId).maybeSingle(),
      ]);
      if (texts.error || renderings.error) throw new StoreError("renderPage");
      const stored = row(texts.data);
      const rendering = row(renderings.data);
      if (stored && typeof stored.text !== "string") throw new StoreError("renderPage");
      if (rendering && (typeof rendering.text !== "string" || typeof rendering.based_on !== "string")) throw new StoreError("renderPage");
      return {
        status: found.status as PageStatus,
        pageType: found.page_type as PageType,
        text: stored ? stored.text as string : null,
        rendering: rendering ? { text: rendering.text as string, basedOn: rendering.based_on as string } : null,
      };
    },
    charge: async (userId) => {
      const { data, error } = await client.rpc("charge_render", { p_user_id: userId });
      const found = first(data);
      if (error || !found || typeof found.allowed !== "boolean" || !Number.isInteger(found.used)) throw new StoreError("chargeRender");
      return { allowed: found.allowed, used: found.used as number };
    },
    save: async (userId, pageId, rendering) => {
      const { error } = await client.from("page_renderings").upsert({
        page_id: pageId,
        user_id: userId,
        text: rendering.text,
        based_on: rendering.basedOn,
        model: rendering.model,
        prompt_version: rendering.promptVersion,
        created_at: new Date().toISOString(),
      }, { onConflict: "page_id" });
      if (error) throw new StoreError("saveRendering");
    },
  };
}

const PARENT_REQUEST_OUTCOMES: readonly string[] = ["requested", "account_not_registered", "age_missing", "not_under_age", "consent_already_active", "invalid_email", "same_email", "send_limit"];
const PARENT_CONFIRM_OUTCOMES: readonly string[] = [
  "confirmed",
  "no_request",
  "invalid_code",
  "code_expired",
  "wrong_code",
  "account_not_registered",
  "consent_version_outdated",
  "age_missing",
  "not_under_age",
  "consent_already_active",
];
const SIX_DIGITS = /^[0-9]{6}$/;

export function createParentConsentStore(keys: Keys, fetchImpl?: typeof fetch): ParentConsentStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    request: async (userId, parentEmail) => {
      const { data, error } = await client.rpc("request_parent_consent", { p_user_id: userId, p_parent_email: parentEmail });
      const found = first(data);
      if (error || !found || !PARENT_REQUEST_OUTCOMES.includes(String(found.outcome))) throw new StoreError("requestParent");
      const outcome = found.outcome as ParentRequestOutcome;
      if (outcome !== "requested") {
        if (found.request_id !== null || found.code !== null) throw new StoreError("requestParent");
        return { outcome, requestId: null, code: null };
      }
      if (typeof found.request_id !== "string" || !UUID.test(found.request_id)) throw new StoreError("requestParent");
      if (typeof found.code !== "string" || !SIX_DIGITS.test(found.code)) throw new StoreError("requestParent");
      return { outcome, requestId: found.request_id, code: found.code };
    },
    withdraw: async (userId, requestId) => {
      const { error } = await client.rpc("withdraw_parent_request", { p_user_id: userId, p_request_id: requestId });
      if (error) throw new StoreError("withdrawParent");
    },
    confirm: async (userId, code) => {
      const { data, error } = await client.rpc("confirm_parent_consent", { p_user_id: userId, p_code: code });
      const found = first(data);
      if (error || !found || !PARENT_CONFIRM_OUTCOMES.includes(String(found.outcome))) throw new StoreError("confirmParent");
      const outcome = found.outcome as ParentConfirmOutcome;
      const left = found.attempts_left;
      if (outcome === "wrong_code") {
        if (typeof left !== "number" || !Number.isInteger(left) || left < 0 || left > 4) throw new StoreError("confirmParent");
        return { outcome, attemptsLeft: left };
      }
      if (left !== null) throw new StoreError("confirmParent");
      return { outcome, attemptsLeft: null };
    },
  };
}

const WRITING_BEGIN_OUTCOMES: readonly string[] = ["started", "consent_required", "test_in_progress", "test_limit"];
const WRITING_FINISH_OUTCOMES: readonly string[] = ["accepted", "rejected", "test_not_found", "consent_required"];

function identifiers(value: unknown, operation: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && UUID.test(item))) throw new StoreError(operation);
  return value as string[];
}

export function createWritingTestStore(keys: Keys, fetchImpl?: typeof fetch): WritingTestStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    begin: async (userId, template) => {
      const { data, error } = await client.rpc("begin_writing_test", { p_user_id: userId, p_template: template });
      const found = first(data);
      if (error || !found || !WRITING_BEGIN_OUTCOMES.includes(String(found.outcome))) throw new StoreError("beginWritingTest");
      const outcome = found.outcome as WritingBegin["outcome"];
      const expired = identifiers(found.expired, "beginWritingTest");
      if (outcome !== "started") {
        if (found.test_id !== null) throw new StoreError("beginWritingTest");
        return { outcome, testId: null, expired };
      }
      if (typeof found.test_id !== "string" || !UUID.test(found.test_id)) throw new StoreError("beginWritingTest");
      return { outcome, testId: found.test_id, expired };
    },
    pending: async (userId, testId) => {
      const { data, error } = await client
        .from("writing_tests")
        .select("template")
        .eq("id", testId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .maybeSingle();
      if (error) throw new StoreError("pendingWritingTest");
      const found = row(data);
      if (found === null) return null;
      if (!isTemplate(found.template)) throw new StoreError("pendingWritingTest");
      return { template: found.template };
    },
    finish: async (userId, testId, counts) => {
      const { data, error } = await client.rpc("finish_writing_test", {
        p_user_id: userId,
        p_test_id: testId,
        p_sheet1_training: counts.sheet1Training,
        p_sheet2_training: counts.sheet2Training,
        p_sheet2_validation: counts.sheet2Validation,
      });
      const found = first(data);
      if (error || !found || !WRITING_FINISH_OUTCOMES.includes(String(found.outcome))) throw new StoreError("finishWritingTest");
      const redo = found.redo;
      if (!Array.isArray(redo) || !redo.every((sheet) => sheet === 1 || sheet === 2)) throw new StoreError("finishWritingTest");
      return { outcome: found.outcome as WritingFinish["outcome"], redo: redo as number[], replaced: identifiers(found.replaced, "finishWritingTest") };
    },
    fail: async (userId, testId) => {
      const { data, error } = await client.rpc("fail_writing_test", { p_user_id: userId, p_test_id: testId });
      if (error || typeof data !== "boolean") throw new StoreError("failWritingTest");
      return data;
    },
    createUploadUrl: async (path) => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new StoreError("createUploadUrl");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    downloadPhoto: (path) => pageReader(client).downloadPhoto(path),
    removeTestFiles: (userId, testId) => removeFolder(client, BUCKET, `${userId}/writing-tests/${testId}`),
  };
}

const UPLOAD_OUTCOMES: readonly string[] = ["ready", "task_not_found", "task_expired", "consent_required"];
const REPORT_OUTCOMES: readonly string[] = ["activated", "rejected", "failed", "model_missing", "task_not_found", "task_expired", "consent_required"];
const MODEL_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.safetensors$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LANGUAGE = /^[a-z]{2}$/;
const MAX_TASK_PAGES = 300;

function uuidOf(value: unknown, operation: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new StoreError(operation);
  return value.toLowerCase();
}

function trainingPage(value: unknown): TrainingPage {
  const page = row(value);
  if (!page || typeof page.b1 !== "string" || !Array.isArray(page.corrections)) throw new StoreError("claimTraining");
  if (page.language !== null && (typeof page.language !== "string" || !LANGUAGE.test(page.language))) throw new StoreError("claimTraining");
  return {
    pageId: uuidOf(page.page_id, "claimTraining"),
    b1: page.b1,
    language: page.language as string | null,
    corrections: page.corrections.map((entry) => {
      const correction = row(entry);
      const index = correction?.token_index;
      if (!correction || typeof index !== "number" || !Number.isInteger(index) || index < 0 || typeof correction.text !== "string") {
        throw new StoreError("claimTraining");
      }
      if (correction.reading_a !== null && typeof correction.reading_a !== "string") throw new StoreError("claimTraining");
      return { tokenIndex: index, text: correction.text, readingA: correction.reading_a as string | null };
    }),
  };
}

function claimedTask(value: unknown): ClaimedTask | null {
  if (value === null) return null;
  const task = row(value);
  if (!task || !isTemplate(task.template) || !Array.isArray(task.pages) || task.pages.length > MAX_TASK_PAGES) throw new StoreError("claimTraining");
  const userId = uuidOf(task.user_id, "claimTraining");
  let model: ClaimedTask["model"] = null;
  if (task.model !== null) {
    const found = row(task.model);
    if (!found || typeof found.path !== "string" || !MODEL_PATH.test(found.path) || !found.path.startsWith(`${userId}/`)) throw new StoreError("claimTraining");
    if (typeof found.sha256 !== "string" || !SHA256.test(found.sha256)) throw new StoreError("claimTraining");
    model = { path: found.path, sha256: found.sha256 };
  }
  return {
    taskId: uuidOf(task.task_id, "claimTraining"),
    userId,
    testId: uuidOf(task.test_id, "claimTraining"),
    template: task.template,
    model,
    pages: task.pages.map(trainingPage),
  };
}

function relativeUrl(signedUrl: unknown, prefix: string): string | null {
  if (typeof signedUrl !== "string") return null;
  let url: URL;
  try {
    url = new URL(signedUrl);
  } catch {
    return null;
  }
  if (!url.pathname.startsWith(prefix) || !url.searchParams.has("token")) return null;
  return url.pathname + url.search;
}

export function createTrainingStore(keys: Keys, fetchImpl?: typeof fetch): TrainingStore {
  const client: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION, global: { fetch: fetchImpl } });
  return {
    claim: async () => {
      const { data, error } = await client.rpc("claim_training_task");
      if (error) throw new StoreError("claimTraining");
      return claimedTask(data ?? null);
    },
    uploadTarget: async (taskId) => {
      const { data, error } = await client.rpc("training_upload_target", { p_attempt_id: taskId });
      const found = first(data);
      if (error || !found || !UPLOAD_OUTCOMES.includes(String(found.outcome))) throw new StoreError("uploadTarget");
      const outcome = found.outcome as UploadOutcome;
      if (outcome !== "ready") {
        if (found.path !== null) throw new StoreError("uploadTarget");
        return { outcome, path: null };
      }
      if (typeof found.path !== "string" || !MODEL_PATH.test(found.path) || !found.path.endsWith(`/${taskId}.safetensors`)) {
        throw new StoreError("uploadTarget");
      }
      return { outcome, path: found.path };
    },
    report: async (taskId, report: TrainingReport) => {
      const measures = report.outcome === "trained" ? report.measures : null;
      const { data, error } = await client.rpc("report_training_task", {
        p_attempt_id: taskId,
        p_outcome: report.outcome,
        p_cer: measures?.cer ?? null,
        p_base_cer: measures?.baseCer ?? null,
        p_faults: measures?.faults ?? null,
        p_base_faults: measures?.baseFaults ?? null,
        p_alphabet: measures?.alphabet ?? null,
        p_samples: measures?.samples ?? null,
        p_sha256: measures?.sha256 ?? null,
      });
      const found = first(data);
      if (error || !found || !REPORT_OUTCOMES.includes(String(found.outcome))) throw new StoreError("reportTraining");
      const remove = found.remove;
      if (!Array.isArray(remove) || !remove.every((path) => typeof path === "string" && MODEL_PATH.test(path))) throw new StoreError("reportTraining");
      return { outcome: found.outcome as ReportOutcome, remove: remove as string[] };
    },
    signedReads: async (bucket: TrainingBucket, paths, seconds) => {
      if (paths.length === 0) return [];
      const { data, error } = await client.storage.from(bucket).createSignedUrls([...paths], seconds);
      if (error || !Array.isArray(data) || data.length !== paths.length) throw new StoreError("signedReads");
      return data.map((entry) => (entry.error ? null : relativeUrl(entry.signedUrl, `/storage/v1/object/sign/${bucket}/`)));
    },
    signedUpload: async (path) => {
      const { data, error } = await client.storage.from("models").createSignedUploadUrl(path, { upsert: true });
      const url = data ? relativeUrl(data.signedUrl, `/storage/v1/object/upload/sign/models/`) : null;
      if (error || !url) throw new StoreError("signedUpload");
      return url;
    },
    removeModels: async (paths) => {
      if (!paths.every((path) => MODEL_PATH.test(path))) throw new StoreError("removeModels");
      for (let start = 0; start < paths.length; start += REMOVE_BATCH_SIZE) {
        const { error } = await client.storage.from("models").remove(paths.slice(start, start + REMOVE_BATCH_SIZE));
        if (error) throw new StoreError("removeModels");
      }
    },
  };
}

