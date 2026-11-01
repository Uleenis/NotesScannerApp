import * as SecureStore from "expo-secure-store";

import { closeAccountStores, openAccountStore, wipeAccountStore } from "@/offline/store";
import { PHOTO_BYTES_MAX } from "@/offline/photos";
import { VIEW_FOLDER, eraseViewFile, writeViewFile } from "@/offline/view";

import {
  fakeDatabases,
  fakeFiles,
  fakeOpened,
  fakeRandom,
  fakeSecure,
  fakeSqlite,
  resetOffline,
  textBytes,
} from "./fake-offline";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

const USER = "0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b";
const OTHER = "7d2e4f6a-8b1c-4d3e-a5f7-9b1d3f5a7c9e";
const PAGE = "11111111-2222-4333-8444-555555555555";
const PAGE_TWO = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const FOLDER = `file:///docs/offline/${USER}`;
const KEY_NAME = `offline-key.${USER}`;

function photo(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) % 256;
  }
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((byte, index) => haystack[start + index] === byte)) {
      return true;
    }
  }
  return false;
}

function fromHex(text: string): Uint8Array {
  return new Uint8Array((text.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)));
}

async function reopen(userId = USER) {
  const { store } = await openAccountStore(userId);
  await store.close();
  return openAccountStore(userId);
}

beforeEach(async () => {
  await closeAccountStores();
  resetOffline();
});

describe("the key of an account", () => {
  it("is drawn once by the system generator, 256 bits, and kept in the secure store of this phone alone", async () => {
    const { store, lostPending } = await openAccountStore(USER);
    await store.close();
    await openAccountStore(USER);

    expect(lostPending).toBe(0);
    expect(fakeRandom.calls).toBe(1);
    expect(fakeSecure.values.get(KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    expect(fakeSecure.calls.filter((call) => call.action === "set")).toHaveLength(1);
    for (const call of fakeSecure.calls) {
      expect(call.options).toEqual({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
  });

  it("is written nowhere else: not in any file, not in any statement, not in any log", async () => {
    const logs = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    const master = fakeSecure.values.get(KEY_NAME) ?? "";
    const masterBytes = fromHex(master);

    for (const content of fakeFiles.values()) {
      expect(contains(content, masterBytes)).toBe(false);
      expect(contains(content, textBytes(master))).toBe(false);
    }
    for (const statement of fakeOpened.flatMap((database) => database.statements)) {
      expect(statement).not.toContain(master);
    }
    for (const spy of [logs, warnings, errors]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(master);
      spy.mockRestore();
    }
  });

  it("opens the database with a key derived from it as the very first statement, and refuses a build without SQLCipher", async () => {
    await openAccountStore(USER);

    const [database] = fakeOpened;
    expect(database.statements[0]).toMatch(/^PRAGMA key = "x'[0-9a-f]{64}'"$/);
    expect(database.statements[0]).not.toContain(fakeSecure.values.get(KEY_NAME));
    expect(fakeDatabases.get(`${FOLDER}/store.db`)?.key).toMatch(/^[0-9a-f]{64}$/);

    await closeAccountStores();
    resetOffline();
    fakeSqlite.cipher = false;
    await expect(openAccountStore(USER)).rejects.toThrow("cipher_missing");
    expect([...fakeDatabases.values()].flatMap((file) => file.tables)).toEqual([]);
    expect(fakeOpened[0].closed).toBe(true);
  });

  it("creates the tables of the store once, in one version", async () => {
    await openAccountStore(USER);
    const created = fakeDatabases.get(`${FOLDER}/store.db`);
    await reopen();

    expect(created?.userVersion).toBe(1);
    expect([...(created?.tables ?? [])].sort()).toEqual(
      ["chapters", "known_limit", "notebooks", "page_alerts", "page_renderings", "pages", "photos", "queue"].sort(),
    );
  });

  it("opens the database and the photos only with this key: another key opens neither", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    await store.close();
    const sealed = fakeFiles.get(`${FOLDER}/pages/${PAGE}.bin`) ?? new Uint8Array(0);
    const database = fakeDatabases.get(`${FOLDER}/store.db`);

    fakeSecure.values.set(KEY_NAME, "ab".repeat(32));
    const opened = await openAccountStore(USER);

    expect(opened.store).toBeDefined();
    expect(fakeDatabases.get(`${FOLDER}/store.db`)).not.toBe(database);
    expect(fakeFiles.has(`${FOLDER}/pages/${PAGE}.bin`)).toBe(false);
    fakeFiles.set(`${FOLDER}/pages/${PAGE}.bin`, sealed);
    expect(await opened.store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
  });

  it("when it cannot be read, erases everything the phone keeps of the account and tells how many waiting pages were lost", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    await store.queuePhotos.save(PAGE, photo());
    await store.queuePhotos.save(PAGE_TWO, photo());
    await store.close();
    const before = fakeSecure.values.get(KEY_NAME);

    fakeSecure.getFails = 1;
    const { store: rebuilt, lostPending } = await openAccountStore(USER);

    expect(lostPending).toBe(2);
    expect(fakeSecure.values.get(KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    expect(fakeSecure.values.get(KEY_NAME)).not.toBe(before);
    expect(fakeSecure.calls.some((call) => call.action === "delete" && call.key === KEY_NAME)).toBe(true);
    expect(await rebuilt.pagePhotos.open(PAGE)).toEqual({ status: "missing" });
    expect(await rebuilt.queuePhotos.open(PAGE)).toEqual({ status: "missing" });
    expect(fakeDatabases.get(`${FOLDER}/store.db`)?.userVersion).toBe(1);
  });

  it("when it is not a key of 256 bits, is unreadable too", async () => {
    const { store } = await openAccountStore(USER);
    await store.queuePhotos.save(PAGE, photo());
    await store.close();

    fakeSecure.values.set(KEY_NAME, "not a key");
    const { lostPending } = await openAccountStore(USER);

    expect(lostPending).toBe(1);
    expect(fakeSecure.values.get(KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("when it is gone but files of the account are left, erases them before drawing a new one", async () => {
    const { store } = await openAccountStore(USER);
    await store.queuePhotos.save(PAGE, photo());
    await store.close();

    fakeSecure.values.delete(KEY_NAME);
    const { store: rebuilt, lostPending } = await openAccountStore(USER);

    expect(lostPending).toBe(1);
    expect(await rebuilt.queuePhotos.open(PAGE)).toEqual({ status: "missing" });
    expect(fakeRandom.calls).toBe(2);
  });

  it("is drawn only once when two openings race, and both get the same store", async () => {
    const [first, second] = await Promise.all([openAccountStore(USER), openAccountStore(USER)]);

    expect(fakeRandom.calls).toBe(1);
    expect(first.store).toBe(second.store);
    expect(fakeOpened).toHaveLength(1);
  });

  it("refuses an account id that is not a UUID before touching anything", async () => {
    for (const id of ["", "../other", `${USER}/..`, USER.toUpperCase(), `${USER}\n`]) {
      await expect(openAccountStore(id)).rejects.toThrow("invalid_id");
    }
    expect(fakeSecure.calls).toEqual([]);
    expect(fakeFiles.size).toBe(0);
  });
});

describe("the photos", () => {
  it("open as they were saved, and never as clear bytes on disk", async () => {
    const { store } = await openAccountStore(USER);
    const bytes = photo();
    await store.pagePhotos.save(PAGE, bytes);

    const sealed = fakeFiles.get(`${FOLDER}/pages/${PAGE}.bin`) ?? new Uint8Array(0);
    expect(sealed.length).toBe(bytes.length + 28);
    expect(contains(sealed, bytes.slice(0, 4))).toBe(false);
    expect(contains(sealed, bytes.slice(100, 132))).toBe(false);
    const opened = await store.pagePhotos.open(PAGE);
    expect(opened.status).toBe("ok");
    expect(opened.status === "ok" && hex(opened.bytes) === hex(bytes)).toBe(true);
  });

  it("sealed under the id of one page do not open under the id of another", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    fakeFiles.set(`${FOLDER}/pages/${PAGE_TWO}.bin`, fakeFiles.get(`${FOLDER}/pages/${PAGE}.bin`) ?? new Uint8Array(0));

    expect(await store.pagePhotos.open(PAGE_TWO)).toEqual({ status: "refused" });
    expect((await store.pagePhotos.open(PAGE)).status).toBe("ok");
  });

  it("of a waiting page do not open as the photo of a page, nor the other way round", async () => {
    const { store } = await openAccountStore(USER);
    await store.queuePhotos.save(PAGE, photo());
    fakeFiles.set(`${FOLDER}/pages/${PAGE}.bin`, fakeFiles.get(`${FOLDER}/queue/${PAGE}.bin`) ?? new Uint8Array(0));

    expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
  });

  it("modified by one byte anywhere are refused", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    const uri = `${FOLDER}/pages/${PAGE}.bin`;
    const sealed = fakeFiles.get(uri) ?? new Uint8Array(0);

    for (const position of [0, 11, 12, 500, sealed.length - 17, sealed.length - 1]) {
      const changed = new Uint8Array(sealed);
      changed[position] ^= 0x01;
      fakeFiles.set(uri, changed);
      expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
    }
    fakeFiles.set(uri, sealed.slice(0, sealed.length - 1));
    expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
    fakeFiles.set(uri, new Uint8Array(0));
    expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
  });

  it("of one account do not open in another", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    const { store: other } = await openAccountStore(OTHER);
    fakeFiles.set(`file:///docs/offline/${OTHER}/pages/${PAGE}.bin`, fakeFiles.get(`${FOLDER}/pages/${PAGE}.bin`) ?? new Uint8Array(0));

    expect(await other.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
  });

  it("are bounded: empty, too large or with an id that is not a UUID are refused", async () => {
    const { store } = await openAccountStore(USER);

    await expect(store.pagePhotos.save(PAGE, new Uint8Array(0))).rejects.toThrow("photo_size");
    await expect(store.pagePhotos.save(PAGE, new Uint8Array(PHOTO_BYTES_MAX + 1))).rejects.toThrow("photo_size");
    await expect(store.pagePhotos.save("../x", photo())).rejects.toThrow("invalid_id");
    await expect(store.pagePhotos.open("../x")).rejects.toThrow("invalid_id");
    fakeFiles.set(`${FOLDER}/pages/${PAGE}.bin`, new Uint8Array(PHOTO_BYTES_MAX + 29));
    expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "refused" });
  });

  it("can be removed one by one", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    store.pagePhotos.remove(PAGE);
    store.pagePhotos.remove(PAGE);

    expect(await store.pagePhotos.open(PAGE)).toEqual({ status: "missing" });
  });
});

describe("wiping an account", () => {
  it("closes its database, erases its database, photos and key, tells the waiting pages lost, and leaves other accounts alone", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    await store.queuePhotos.save(PAGE, photo());
    const { store: other } = await openAccountStore(OTHER);
    await other.pagePhotos.save(PAGE, photo());

    const lost = await wipeAccountStore(USER);

    expect(lost).toBe(1);
    expect(fakeOpened[0].closed).toBe(true);
    expect([...fakeFiles.keys()].filter((uri) => uri.startsWith(FOLDER))).toEqual([]);
    expect(fakeDatabases.has(`${FOLDER}/store.db`)).toBe(false);
    expect(fakeSecure.values.has(KEY_NAME)).toBe(false);
    expect((await other.pagePhotos.open(PAGE)).status).toBe("ok");
    expect(fakeSecure.values.has(`offline-key.${OTHER}`)).toBe(true);
  });

  it("of an account never opened on this phone erases nothing and loses nothing", async () => {
    expect(await wipeAccountStore(USER)).toBe(0);
    await expect(wipeAccountStore("../")).rejects.toThrow("invalid_id");
  });

  it("then opening again draws a new key on an empty store", async () => {
    const { store } = await openAccountStore(USER);
    await store.pagePhotos.save(PAGE, photo());
    const before = fakeSecure.values.get(KEY_NAME);
    await wipeAccountStore(USER);

    const { store: fresh, lostPending } = await openAccountStore(USER);

    expect(lostPending).toBe(0);
    expect(fakeSecure.values.get(KEY_NAME)).not.toBe(before);
    expect(await fresh.pagePhotos.open(PAGE)).toEqual({ status: "missing" });
  });
});

describe("a photo shown from a file", () => {
  it("is written in clear only in its own folder of the cache, and erased when the page closes", async () => {
    const bytes = photo();
    const file = writeViewFile(bytes);

    expect(VIEW_FOLDER).toBe("offline-view");
    expect(file.uri).toMatch(/^file:\/\/\/cache\/offline-view\/[0-9a-f-]{36}\.jpg$/);
    expect(hex(fakeFiles.get(file.uri) ?? new Uint8Array(0))).toBe(hex(bytes));
    eraseViewFile(file);
    eraseViewFile(file);
    expect(fakeFiles.has(file.uri)).toBe(false);
  });
});
