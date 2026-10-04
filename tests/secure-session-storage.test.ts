import { CHUNK_SIZE, createChunkedStorage, type SecureValueStore } from "@/lib/secure-session-storage";

function fakeStore(): SecureValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
}

const KEY = "sb-192-auth-token";

function session(length: number): string {
  return JSON.stringify({ access_token: "a".repeat(length) });
}

test("gives back a short value unchanged", async () => {
  const storage = createChunkedStorage(fakeStore());
  await storage.setItem(KEY, "short");
  expect(await storage.getItem(KEY)).toBe("short");
});

test("gives back a session of about 3 KB unchanged", async () => {
  const storage = createChunkedStorage(fakeStore());
  const value = session(3000);
  await storage.setItem(KEY, value);
  expect(await storage.getItem(KEY)).toBe(value);
});

test("gives back multi-byte text unchanged", async () => {
  const storage = createChunkedStorage(fakeStore());
  const value = JSON.stringify({ name: "é😀日本".repeat(700) });
  await storage.setItem(KEY, value);
  expect(await storage.getItem(KEY)).toBe(value);
});

test("never splits an emoji between two entries", async () => {
  const store = fakeStore();
  const storage = createChunkedStorage(store);
  const value = JSON.stringify({ name: `aa${"😀".repeat(1500)}` });
  await storage.setItem(KEY, value);
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (const stored of store.values.values()) {
    expect(stored).not.toMatch(loneSurrogate);
  }
  expect(await storage.getItem(KEY)).toBe(value);
});

test("never stores more than 600 characters in one entry", async () => {
  const store = fakeStore();
  await createChunkedStorage(store).setItem(KEY, session(5000));
  expect(CHUNK_SIZE).toBe(600);
  for (const stored of store.values.values()) {
    expect(stored.length).toBeLessThanOrEqual(CHUNK_SIZE);
  }
});

test("only uses key names the secure store accepts", async () => {
  const store = fakeStore();
  await createChunkedStorage(store).setItem(KEY, session(2000));
  for (const key of store.values.keys()) {
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  }
});

test("answers null for a key that was never stored", async () => {
  expect(await createChunkedStorage(fakeStore()).getItem(KEY)).toBeNull();
});

test("a shorter value written over a longer one leaves no stale entry", async () => {
  const store = fakeStore();
  const storage = createChunkedStorage(store);
  await storage.setItem(KEY, session(5000));
  await storage.setItem(KEY, "short");
  expect(await storage.getItem(KEY)).toBe("short");
  expect(store.values.size).toBeLessThanOrEqual(2);
});

test("removing a value removes every entry", async () => {
  const store = fakeStore();
  const storage = createChunkedStorage(store);
  await storage.setItem(KEY, session(5000));
  await storage.removeItem(KEY);
  expect(await storage.getItem(KEY)).toBeNull();
  expect(store.values.size).toBe(0);
});

test("removing a key that was never stored does nothing", async () => {
  const storage = createChunkedStorage(fakeStore());
  await expect(storage.removeItem(KEY)).resolves.toBeUndefined();
});

test("answers null when an entry is missing instead of a half-read value", async () => {
  const store = fakeStore();
  const storage = createChunkedStorage(store);
  await storage.setItem(KEY, session(3000));
  const chunkKey = [...store.values.keys()].find((key) => key.endsWith(".1"));
  expect(chunkKey).toBeDefined();
  store.values.delete(chunkKey as string);
  expect(await storage.getItem(KEY)).toBeNull();
});

test("keeps two keys apart", async () => {
  const storage = createChunkedStorage(fakeStore());
  await storage.setItem("one", session(2000));
  await storage.setItem("two", session(1000));
  expect(await storage.getItem("one")).toBe(session(2000));
  expect(await storage.getItem("two")).toBe(session(1000));
});
