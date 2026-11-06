import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { signedInAccount } from "@/auth/session";
import { readStoredSession } from "@/auth/stored-account";
import { captureService } from "@/capture/service";
import { getSupabase } from "@/lib/supabase";
import { notebookService } from "@/notebooks/service";
import { putAlerts, putRendering, replaceChapters, replaceNotebooks, replacePages } from "@/offline/library";
import { putLimit } from "@/offline/limit";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { setOnline } from "@/offline/network";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";
import { pageService } from "@/pages/service";
import { renderService } from "@/render/service";

import { resetOffline } from "./fake-offline";
import { USER, chapter, notebook, page } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("expo-image-manipulator", () => ({}));
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: jest.fn() }));

const STORAGE_KEY = "sb-test-auth-token";
const HOUR_S = 3600;
const LONGER_THAN_THE_LIBRARY_RETRIES_MS = 40_000;

let client: SupabaseClient;
let saved: Map<string, string>;
let store: AccountStore;

function expiredSession(): string {
  return JSON.stringify({
    access_token: "a.b.c",
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: HOUR_S,
    expires_at: Math.floor(Date.now() / 1000) - HOUR_S,
    user: { id: USER, is_anonymous: true, aud: "authenticated" },
  });
}

beforeEach(async () => {
  resetOffline();
  store = (await openAccountStore(USER)).store;
  await replaceNotebooks(store, [notebook(1)]);
  await replaceChapters(store, [chapter(1, 1)]);
  await replacePages(store, [page(1, 1)]);
  await putAlerts(store, page(1, 1).id, ["missing_line"]);
  await putRendering(store, page(1, 1).id, { text: "rich", basedOn: "abc" });
  await putLimit(store, {
    isAnonymous: true,
    used: 5,
    max: 15,
    remaining: 10,
    resetsAt: "2099-01-01T00:00:00.000Z",
    blockedReason: null,
  });

  jest.useFakeTimers();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);

  saved = new Map([[STORAGE_KEY, expiredSession()]]);
  client = createClient("http://test.local:54321", "publishable", {
    auth: {
      storage: {
        getItem: async (key) => saved.get(key) ?? null,
        setItem: async (key, value) => {
          saved.set(key, value);
        },
        removeItem: async (key) => {
          saved.delete(key);
        },
      },
      storageKey: STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    },
  });
  jest.mocked(getSupabase).mockReturnValue(client);
  setMirrorIdentity(() =>
    signedInAccount(client, {
      stored: async () => readStoredSession(saved.get(STORAGE_KEY) ?? null, Date.now()),
      offline: async () => true,
    }),
  );
});

afterEach(async () => {
  await jest.advanceTimersByTimeAsync(LONGER_THAN_THE_LIBRARY_RETRIES_MS);
  await client.auth.stopAutoRefresh();
  jest.useRealTimers();
  jest.restoreAllMocks();
  setMirrorStore(null);
  setMirrorIdentity(null);
  setOnline(true);
  await closeAccountStores();
});

const reads: [string, () => Promise<unknown>, (value: unknown) => void][] = [
  ["the notebooks", () => notebookService.list(), (value) => expect(value).toEqual([notebook(1)])],
  ["one notebook", () => notebookService.get(notebook(1).id), (value) => expect(value).toEqual(notebook(1))],
  ["the chapters", () => notebookService.chapters(), (value) => expect(value).toEqual([chapter(1, 1)])],
  ["the pages", () => pageService.list(), (value) => expect(value).toMatchObject([{ id: page(1, 1).id, number: 1 }])],
  ["one page", () => pageService.get(page(1, 1).id), (value) => expect(value).toMatchObject({ id: page(1, 1).id, number: 1 })],
  ["the alerts", () => pageService.alerts(page(1, 1).id), (value) => expect(value).toEqual(["missing_line"])],
  ["the rendering", () => renderService.read(page(1, 1).id), (value) => expect(value).toEqual({ text: "rich", basedOn: "abc" })],
  ["the allowance", () => captureService.allowance(), (value) => expect(value).toMatchObject({ remaining: 10, max: 15 })],
];

describe("a start without a network, with a session expired for an hour", () => {
  it.each(reads)("shows %s as soon as the store opens, though the read started first", async (_name, read, check) => {
    setOnline(false);
    const outcome = jest.fn();
    void read().then(outcome);
    await jest.advanceTimersByTimeAsync(1000);
    expect(outcome).not.toHaveBeenCalled();

    setMirrorStore(store);
    await jest.advanceTimersByTimeAsync(100);
    expect(outcome).toHaveBeenCalledTimes(1);
    check(outcome.mock.calls[0][0]);
  });

  it.each(reads)("shows %s as soon as the store opens, though the flag still said online when the read started", async (_name, read, check) => {
    setOnline(true);
    const outcome = jest.fn();
    void read().then(outcome);
    await jest.advanceTimersByTimeAsync(100);
    setOnline(false);
    await jest.advanceTimersByTimeAsync(1000);
    expect(outcome).not.toHaveBeenCalled();

    setMirrorStore(store);
    await jest.advanceTimersByTimeAsync(100);
    expect(outcome).toHaveBeenCalledTimes(1);
    check(outcome.mock.calls[0][0]);
  });

  it("keeps the stored session once the retries of the library have failed", async () => {
    setOnline(false);
    setMirrorStore(store);
    await notebookService.list();
    await jest.advanceTimersByTimeAsync(LONGER_THAN_THE_LIBRARY_RETRIES_MS);
    expect(saved.has(STORAGE_KEY)).toBe(true);
  });
});
