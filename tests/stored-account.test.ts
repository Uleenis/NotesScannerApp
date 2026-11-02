import { createClient } from "@supabase/supabase-js";

import { EXPIRY_MARGIN_MS, STORED_SESSION_CHARS_MAX, readStoredSession, storageKeyFor } from "@/auth/stored-account";

const USER = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";
const NOW = 1_800_000_000_000;

function stored(overrides: Record<string, unknown> = {}, user: Record<string, unknown> = {}): string {
  return JSON.stringify({
    access_token: "access",
    refresh_token: "refresh",
    expires_at: NOW / 1000 + 3600,
    user: { id: USER, is_anonymous: false, email: "reader@example.test", ...user },
    ...overrides,
  });
}

describe("the account of the session stored on this phone", () => {
  it("is read from the stored session: its id and whether it is anonymous, never its e-mail or tokens", () => {
    expect(readStoredSession(stored(), NOW)).toEqual({ userId: USER, isAnonymous: false, expired: false });
    expect(readStoredSession(stored({}, { is_anonymous: true }), NOW)).toEqual({ userId: USER, isAnonymous: true, expired: false });
    expect(readStoredSession(stored({}, { is_anonymous: undefined }), NOW)).toEqual({ userId: USER, isAnonymous: true, expired: false });
  });

  it("is expired with the margin of the auth client, so that the client would try to refresh it", () => {
    expect(readStoredSession(stored({ expires_at: (NOW + EXPIRY_MARGIN_MS + 1000) / 1000 }), NOW)?.expired).toBe(false);
    expect(readStoredSession(stored({ expires_at: (NOW + EXPIRY_MARGIN_MS - 1000) / 1000 }), NOW)?.expired).toBe(true);
    expect(readStoredSession(stored({ expires_at: NOW / 1000 - 10 }), NOW)?.expired).toBe(true);
  });

  it("is nothing when nothing is stored, or when what is stored is not a session of one account", () => {
    const refused = [
      null,
      "",
      "not json",
      "null",
      "[]",
      '"text"',
      stored({ refresh_token: "" }),
      stored({ refresh_token: undefined }),
      stored({ refresh_token: 12 }),
      stored({ expires_at: "soon" }),
      stored({ expires_at: undefined }),
      stored({ expires_at: Number.NaN }),
      stored({ user: null }),
      stored({ user: "someone" }),
      stored({}, { id: undefined }),
      stored({}, { id: 42 }),
      stored({}, { id: USER.toUpperCase() }),
      stored({}, { id: "../other" }),
      stored({}, { id: `${USER} ` }),
      stored({}, { is_anonymous: "no" }),
    ];
    for (const value of refused) {
      expect(readStoredSession(value, NOW)).toBeNull();
    }
  });

  it("is not read beyond a bounded size", () => {
    const padding = "x".repeat(STORED_SESSION_CHARS_MAX);
    expect(readStoredSession(stored({ padding }), NOW)).toBeNull();
  });
});

describe("the key of the stored session", () => {
  it("is the key the auth client uses by default, so that the session already stored is still found", () => {
    for (const url of ["https://abcdefghijklmnop.supabase.co", "http://127.0.0.1:54321", "http://10.0.2.2:54321/"]) {
      const client = createClient(url, "sb_publishable_test", { auth: { persistSession: false, autoRefreshToken: false } });
      expect(storageKeyFor(url)).toBe((client as unknown as { storageKey: string }).storageKey);
    }
  });
});
