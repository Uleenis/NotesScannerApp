import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  Allowance,
  Auth,
  BlockReason,
  CallerStore,
  ChargeReason,
  ChargeResult,
  PageRow,
  PageStatus,
  PhotoInfo,
  ServerStore,
} from "./ports.ts";

const BUCKET = "photos";

const PAGE_STATUSES: readonly string[] = ["queued", "processing", "read", "failed"];
const BLOCK_REASONS: readonly string[] = ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"];
const CHARGE_REASONS: readonly string[] = ["charged", "already_charged", "page_not_found", ...BLOCK_REASONS];

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
      return error || !data.user ? null : { userId: data.user.id };
    },
  };
}

export function createCallerStore(keys: Keys, token: string, fetchImpl?: typeof fetch): CallerStore {
  const client: SupabaseClient = createClient(keys.url, keys.publishableKey, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchImpl },
  });
  return {
    getPage: async (pageId): Promise<PageRow | null> => {
      const { data, error } = await client.from("pages").select("id, user_id, status").eq("id", pageId).maybeSingle();
      if (error) throw new StoreError("getPage");
      const found = row(data);
      if (!found || typeof found.id !== "string" || typeof found.user_id !== "string" || !PAGE_STATUSES.includes(String(found.status))) return null;
      return { id: found.id, userId: found.user_id, status: found.status as PageStatus };
    },
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
    photoInfo: async (path): Promise<PhotoInfo | null> => {
      const { data, error } = await client.storage.from(BUCKET).info(path);
      if (error || !data) return null;
      return { size: typeof data.size === "number" ? data.size : Number.MAX_SAFE_INTEGER, mimeType: typeof data.contentType === "string" ? data.contentType : null };
    },
    downloadPhoto: async (path): Promise<Uint8Array | null> => {
      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error || !data) throw new StoreError("downloadPhoto");
      return new Uint8Array(await data.arrayBuffer());
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
    claimForReading: async (userId, pageId) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "processing", queue_reason: null })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "queued")
        .select("id");
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
    markRead: async (userId, pageId, readAt) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "read", read_at: readAt, queue_reason: null })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "processing")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("markRead");
    },
    releaseToQueue: async (userId, pageId, reason) => {
      const { data, error } = await client
        .from("pages")
        .update({ status: "queued", queue_reason: reason })
        .eq("id", pageId)
        .eq("user_id", userId)
        .eq("status", "processing")
        .select("id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new StoreError("releaseToQueue");
    },
    createUploadUrl: async (path) => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new StoreError("createUploadUrl");
      return { signedUrl: data.signedUrl, token: data.token };
    },
  };
}
