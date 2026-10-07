import { createClient } from "@supabase/supabase-js";

import { getStatelessSupabase, getSupabase } from "@/lib/supabase";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn(() => ({ auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } })) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));

type AuthOptions = { storage?: unknown; storageKey?: string; persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean };

function authOptionsOfCall(index: number): AuthOptions {
  const call = jest.mocked(createClient).mock.calls[index] as unknown as [string, string, { auth: AuthOptions }];
  return call[2].auth;
}

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

test("the client used to check a code keeps nothing: no storage, no saved session, no refresh", () => {
  getStatelessSupabase();

  const options = authOptionsOfCall(0);
  expect(options.persistSession).toBe(false);
  expect(options.autoRefreshToken).toBe(false);
  expect(options.detectSessionInUrl).toBe(false);
  expect(options.storage).toBeUndefined();
});

test("the client used to check a code has its own storage key, so it never shares the one of the phone", () => {
  expect(authOptionsOfCall(0).storageKey).toBeDefined();
  getSupabase();
  expect(authOptionsOfCall(1).storageKey).toBeUndefined();
  expect(authOptionsOfCall(0).storageKey).not.toBe(authOptionsOfCall(1).storageKey);
});

test("the client of the phone keeps the session in the secure storage and refreshes it", () => {
  const options = authOptionsOfCall(1);
  expect(options.storage).toBeDefined();
  expect(options.persistSession).toBe(true);
  expect(options.autoRefreshToken).toBe(true);
});

test("each client is created once", () => {
  getStatelessSupabase();
  getSupabase();

  expect(jest.mocked(createClient)).toHaveBeenCalledTimes(2);
});
