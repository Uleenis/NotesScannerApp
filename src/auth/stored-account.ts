import { isUuid } from "@/offline/bytes";

export type StoredAccount = { userId: string; isAnonymous: boolean; expired: boolean };

export const STORED_SESSION_CHARS_MAX = 64 * 1024;

export const EXPIRY_MARGIN_MS = 90_000;

export function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parsed(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readStoredSession(value: string | null, now: number): StoredAccount | null {
  if (value === null || value.length === 0 || value.length > STORED_SESSION_CHARS_MAX) {
    return null;
  }
  const session = record(parsed(value));
  const user = record(session?.user);
  if (session === null || user === null) {
    return null;
  }
  const { refresh_token: refreshToken, expires_at: expiresAt } = session;
  const { id, is_anonymous: anonymous } = user;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return null;
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return null;
  }
  if (typeof id !== "string" || !isUuid(id)) {
    return null;
  }
  if (anonymous !== undefined && typeof anonymous !== "boolean") {
    return null;
  }
  return { userId: id, isAnonymous: anonymous !== false, expired: expiresAt * 1000 - now < EXPIRY_MARGIN_MS };
}
