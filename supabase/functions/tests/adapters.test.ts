import { assertEquals } from "jsr:@std/assert@1";
import { createAccountStore, createAuth, createCallerStore, createPageTypeStore, createServerStore, createTransferStore, readKeys, StoreError } from "../_shared/supabase-adapters.ts";
import { ALICE, BOB, PAGE_ID } from "./fakes.ts";

const KEYS = { url: "http://db.test", publishableKey: "publishable-key", secretKey: "secret-key" };

type Call = { method: string; url: URL; headers: Headers; body: unknown };

function stub(respond: (call: Call) => unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return Promise.resolve(new Response(JSON.stringify(respond(call)), { status: 200, headers: { "content-type": "application/json" } }));
  };
  return { fetch: fetcher as typeof fetch, calls };
}

Deno.test("charge_page is called with the page id alone, as the service, and its reason is read back", async () => {
  const { fetch, calls } = stub(() => [{ allowed: true, reason: "already_charged" }]);
  const result = await createServerStore(KEYS, fetch).charge(PAGE_ID);
  assertEquals(result, { allowed: true, reason: "already_charged" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/charge_page");
  assertEquals(calls[0].body, { p_page_id: PAGE_ID });
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
});

Deno.test("an unknown charge reason is an error, never a pass", async () => {
  const { fetch } = stub(() => [{ allowed: true, reason: "something_new" }]);
  let thrown: unknown = null;
  try {
    await createServerStore(KEYS, fetch).charge(PAGE_ID);
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown instanceof StoreError, true);
});

Deno.test("claiming a page filters by owner and by the queued state, and clears queue_reason", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  assertEquals(await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { status: "queued", queueReason: null, retryCount: 0 }), true);
  assertEquals(calls[0].method, "PATCH");
  assertEquals(calls[0].url.pathname, "/rest/v1/pages");
  assertEquals(calls[0].url.searchParams.get("id"), `eq.${PAGE_ID}`);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.queued");
  assertEquals(calls[0].url.searchParams.get("queue_reason"), "is.null");
  assertEquals(calls[0].url.searchParams.get("retry_count"), "eq.0");
  assertEquals(calls[0].body, { status: "processing", queue_reason: null });
});

Deno.test("claiming a relaunched page filters by its queue reason and its relaunch count", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { status: "queued", queueReason: "read_error", retryCount: 2 });
  assertEquals(calls[0].url.searchParams.get("queue_reason"), "eq.read_error");
  assertEquals(calls[0].url.searchParams.get("retry_count"), "eq.2");
});

Deno.test("claiming a failed page filters by the failed state, its count and the cut-off of its last relaunch", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  const claimed = await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, {
    status: "failed",
    retryCount: 3,
    relaunchedBefore: "2026-10-05T10:00:00.000Z",
  });
  assertEquals(claimed, true);
  assertEquals(calls[0].method, "PATCH");
  assertEquals(calls[0].url.searchParams.get("id"), `eq.${PAGE_ID}`);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.failed");
  assertEquals(calls[0].url.searchParams.get("retry_count"), "eq.3");
  assertEquals(calls[0].url.searchParams.get("or"), "(manual_relaunched_at.is.null,manual_relaunched_at.lte.2026-10-05T10:00:00.000Z)");
  assertEquals(calls[0].url.searchParams.get("queue_reason"), null);
  assertEquals(calls[0].body, { status: "processing", queue_reason: null });
});

Deno.test("abandoning a queued page filters by owner, by the queued state and by its cause, and fails it", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).abandonQueued(ALICE, PAGE_ID);
  assertEquals(calls[0].method, "PATCH");
  assertEquals(calls[0].url.pathname, "/rest/v1/pages");
  assertEquals(calls[0].url.searchParams.get("id"), `eq.${PAGE_ID}`);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.queued");
  assertEquals(calls[0].url.searchParams.get("queue_reason"), "eq.read_error");
  assertEquals(calls[0].body, { status: "failed", queue_reason: null });
});

Deno.test("a claim that changes no row is not a claim", async () => {
  const { fetch } = stub(() => []);
  assertEquals(await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { status: "queued", queueReason: null, retryCount: 0 }), false);
});

Deno.test("marking a page read filters by owner and by the processing state, and writes its type in the same update", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).markRead(ALICE, PAGE_ID, "2026-10-05T10:00:00.000Z", "math");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.processing");
  assertEquals(calls[0].body, { status: "read", read_at: "2026-10-05T10:00:00.000Z", queue_reason: null, page_type: "math" });
});

Deno.test("releasing a page filters by owner and by the processing state and writes the relaunch count", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).releaseToQueue(ALICE, PAGE_ID, "read_error", 2);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.processing");
  assertEquals(calls[0].body, { status: "queued", queue_reason: "read_error", retry_count: 2 });
});

Deno.test("failing a page filters by owner and by the processing state, clears queue_reason and writes the relaunch count", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).markFailed(ALICE, PAGE_ID, 3);
  assertEquals(calls[0].method, "PATCH");
  assertEquals(calls[0].url.pathname, "/rest/v1/pages");
  assertEquals(calls[0].url.searchParams.get("id"), `eq.${PAGE_ID}`);
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.processing");
  assertEquals(calls[0].body, { status: "failed", queue_reason: null, retry_count: 3 });
});

Deno.test("a write that changes no row is an error", async () => {
  const { fetch } = stub(() => []);
  const store = createServerStore(KEYS, fetch);
  for (const write of [
    () => store.markRead(ALICE, PAGE_ID, "2026-10-05T10:00:00.000Z", "text"),
    () => store.releaseToQueue(ALICE, PAGE_ID, "read_error", 1),
    () => store.markFailed(ALICE, PAGE_ID, 3),
    () => store.abandonQueued(ALICE, PAGE_ID),
  ]) {
    let thrown: unknown = null;
    try {
      await write();
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown instanceof StoreError, true);
  }
});

Deno.test("the reading, the text and the image are written in the name of the given owner", async () => {
  const { fetch, calls } = stub(() => []);
  const store = createServerStore(KEYS, fetch);
  await store.insertReading(BOB, PAGE_ID, {
    label: "B1",
    rawText: "text",
    model: "gemini-3.6-flash",
    modelVersion: "v",
    promptVersion: "v0",
    thinkingBudget: 0,
    inputTokens: 1,
    outputTokens: 2,
    durationMs: 3,
  });
  await store.upsertPageText(BOB, PAGE_ID, "text", "b1-raw");
  await store.recordOriginalImage(BOB, PAGE_ID, `${BOB}/${PAGE_ID}/original.jpg`);
  assertEquals(calls.map((c) => c.url.pathname), ["/rest/v1/readings", "/rest/v1/page_texts", "/rest/v1/page_images"]);
  for (const call of calls) {
    assertEquals((call.body as Record<string, unknown>).user_id, BOB);
    assertEquals((call.body as Record<string, unknown>).page_id, PAGE_ID);
  }
  assertEquals(calls[2].url.searchParams.get("on_conflict"), "storage_path");
});

Deno.test("the caller's store speaks with the caller's token and the publishable key, never the secret one", async () => {
  const { fetch, calls } = stub(() => ({
    id: PAGE_ID,
    user_id: ALICE,
    status: "queued",
    queue_reason: "read_error",
    retry_count: 2,
    manual_relaunched_at: "2026-10-05T10:00:00+00:00",
  }));
  const page = await createCallerStore(KEYS, "caller-token", fetch).getPage(PAGE_ID);
  assertEquals(page, {
    id: PAGE_ID,
    userId: ALICE,
    status: "queued",
    queueReason: "read_error",
    retryCount: 2,
    manualRelaunchedAt: "2026-10-05T10:00:00+00:00",
  });
  assertEquals(calls[0].url.searchParams.get("select"), "id,user_id,status,queue_reason,retry_count,manual_relaunched_at");
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.pathname, "/rest/v1/pages");
  assertEquals(calls[0].url.searchParams.get("id"), `eq.${PAGE_ID}`);
  assertEquals(calls[0].headers.get("authorization"), "Bearer caller-token");
  assertEquals(calls[0].headers.get("apikey"), "publishable-key");
  assertEquals(JSON.stringify([...calls[0].headers]).includes("secret-key"), false);
});

Deno.test("the allowance is read through my_page_allowance with no argument", async () => {
  const { fetch, calls } = stub(() => [{ is_anonymous: false, used: 2, max: 15, remaining: 13, resets_at: null, blocked_reason: null }]);
  const allowance = await createCallerStore(KEYS, "caller-token", fetch).allowance();
  assertEquals(allowance, { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: null, blockedReason: null });
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/my_page_allowance");
  assertEquals(calls[0].body, {});
});

Deno.test("the keys are read from the dictionaries first, then from the older names", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "http://db.test",
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "new-pub" }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "new-sec" }),
    SUPABASE_ANON_KEY: "old-pub",
    SUPABASE_SERVICE_ROLE_KEY: "old-sec",
  };
  assertEquals(readKeys((name) => env[name]), { url: "http://db.test", publishableKey: "new-pub", secretKey: "new-sec" });
  delete env.SUPABASE_PUBLISHABLE_KEYS;
  delete env.SUPABASE_SECRET_KEYS;
  assertEquals(readKeys((name) => env[name]), { url: "http://db.test", publishableKey: "old-pub", secretKey: "old-sec" });
});

Deno.test("missing keys stop the function without printing any value", () => {
  let thrown: unknown = null;
  try {
    readKeys(() => undefined);
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown instanceof StoreError, true);
});

function answer(status: number, body: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))) as typeof fetch;
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

const STORAGE_NOT_FOUND = { statusCode: "404", error: "not_found", message: "Object not found" };
const STORAGE_BROKEN = { statusCode: "500", error: "internal", message: "Internal error" };

Deno.test("a photo that is not in the storage is a missing photo, whether it is checked or downloaded", async () => {
  const store = createCallerStore(KEYS, "caller-token", answer(400, STORAGE_NOT_FOUND));
  assertEquals(await store.photoInfo("a/b/original.jpg"), null);
  assertEquals(await store.downloadPhoto("a/b/original.jpg"), null);
});

Deno.test("a storage failure is an error, never a missing photo", async () => {
  const store = createCallerStore(KEYS, "caller-token", answer(500, STORAGE_BROKEN));
  assertEquals((await thrownBy(() => store.photoInfo("a/b/original.jpg"))) instanceof StoreError, true);
  assertEquals((await thrownBy(() => store.downloadPhoto("a/b/original.jpg"))) instanceof StoreError, true);
});

Deno.test("a token the accounts service rejects is no caller", async () => {
  const auth = createAuth(KEYS, answer(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" }));
  assertEquals(await auth.verify("garbage"), null);
});

Deno.test("an accounts service that cannot answer is an error, never a rejected token", async () => {
  const unreachable = createAuth(KEYS, (() => Promise.reject(new TypeError("unreachable"))) as typeof fetch);
  assertEquals((await thrownBy(() => unreachable.verify("token"))) instanceof StoreError, true);
  const broken = createAuth(KEYS, answer(500, { code: 500, error_code: "unexpected_failure", msg: "broken" }));
  assertEquals((await thrownBy(() => broken.verify("token"))) instanceof StoreError, true);
  const unavailable = createAuth(KEYS, answer(503, { code: 503, msg: "unavailable" }));
  assertEquals((await thrownBy(() => unavailable.verify("token"))) instanceof StoreError, true);
});

Deno.test("a valid token gives the id of its account", async () => {
  const auth = createAuth(KEYS, answer(200, { id: ALICE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" }));
  assertEquals(await auth.verify("token"), { userId: ALICE, isAnonymous: false });
});

Deno.test("a token of an anonymous account says so, as the accounts service reports it", async () => {
  const auth = createAuth(KEYS, answer(200, { id: ALICE, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" }));
  assertEquals(await auth.verify("token"), { userId: ALICE, isAnonymous: true });
});

Deno.test("a token of an account that is not marked anonymous is not anonymous", async () => {
  const auth = createAuth(KEYS, answer(200, { id: ALICE, aud: "authenticated", role: "authenticated", is_anonymous: false, email: "reader@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" }));
  assertEquals(await auth.verify("token"), { userId: ALICE, isAnonymous: false });
});

Deno.test("a token of an account that has been deleted is no caller", async () => {
  const auth = createAuth(KEYS, answer(403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" }));
  assertEquals(await auth.verify("token"), null);
});

type Entry = { name: string; id: string | null };

type Storage = {
  fetch: typeof fetch;
  files: Set<string>;
  lists: { prefix: string; offset: number; limit: number }[];
  removals: string[][];
  copies: { bucketId: string; sourceKey: string; destinationKey: string }[];
  headers: Headers[];
};

function storageWith(initial: string[], options: { keepFiles?: boolean; failList?: boolean; failCopy?: boolean } = {}, bucket: string = "photos"): Storage {
  const files = new Set(initial);
  const lists: { prefix: string; offset: number; limit: number }[] = [];
  const removals: string[][] = [];
  const copies: { bucketId: string; sourceKey: string; destinationKey: string }[] = [];
  const headers: Headers[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const json = (status: number, value: unknown) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }));
    headers.push(new Headers(init?.headers));
    if (url.pathname === "/storage/v1/object/copy" && init?.method === "POST") {
      copies.push(body);
      if (options.failCopy) return json(500, { statusCode: "500", error: "internal", message: "Internal error" });
      if (files.has(body.destinationKey)) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      if (!files.has(body.sourceKey)) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      files.add(body.destinationKey);
      return json(200, { Key: `${bucket}/${body.destinationKey}` });
    }
    if (url.pathname === `/storage/v1/object/list/${bucket}`) {
      lists.push({ prefix: body.prefix, offset: body.offset, limit: body.limit });
      if (options.failList) return json(500, { message: "boom" });
      const prefix = `${body.prefix}/`;
      const entries = new Map<string, Entry>();
      for (const path of [...files].sort()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) entries.set(rest, { name: rest, id: `id-${path}` });
        else entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
      }
      return json(200, [...entries.values()].slice(body.offset, body.offset + body.limit));
    }
    if (url.pathname === `/storage/v1/object/${bucket}` && init?.method === "DELETE") {
      removals.push(body.prefixes);
      if (!options.keepFiles) for (const path of body.prefixes) files.delete(path);
      return json(200, body.prefixes.map((name: string) => ({ name })));
    }
    return json(404, { message: "unexpected call" });
  };
  return { fetch: fetcher as typeof fetch, files, lists, removals, copies, headers };
}

const ALICE_FILES = Array.from({ length: 250 }, (_, index) => `${ALICE}/page-${String(index).padStart(3, "0")}/original.jpg`);

Deno.test("erasing the photos of an account lists its folders and removes every file under it, 100 at most at a time", async () => {
  const storage = storageWith([...ALICE_FILES, `${BOB}/page-1/original.jpg`]);
  await createAccountStore(KEYS, storage.fetch).removeFiles("photos", ALICE);
  assertEquals([...storage.files], [`${BOB}/page-1/original.jpg`]);
  assertEquals(storage.removals.flat().length, 250);
  assertEquals(storage.removals.every((paths) => paths.length <= 100), true);
  assertEquals(storage.removals.flat().every((path) => path.startsWith(`${ALICE}/`)), true);
  assertEquals(storage.lists.every((list) => list.prefix === ALICE || list.prefix.startsWith(`${ALICE}/`)), true);
});

Deno.test("the listing of a folder with more than 100 entries goes on page after page", async () => {
  const storage = storageWith(ALICE_FILES);
  await createAccountStore(KEYS, storage.fetch).removeFiles("photos", ALICE);
  const offsets = storage.lists.filter((list) => list.prefix === ALICE).map((list) => list.offset);
  assertEquals(offsets.slice(0, 3), [0, 100, 200]);
});

Deno.test("an account with no file removes nothing", async () => {
  const storage = storageWith([`${BOB}/page-1/original.jpg`]);
  await createAccountStore(KEYS, storage.fetch).removeFiles("photos", ALICE);
  assertEquals(storage.removals, []);
  assertEquals(storage.files.size, 1);
});

Deno.test("a file that is still there after the removal is an error, never a pass", async () => {
  const storage = storageWith([`${ALICE}/page-1/original.jpg`], { keepFiles: true });
  const error = await thrownBy(() => createAccountStore(KEYS, storage.fetch).removeFiles("photos", ALICE));
  assertEquals(error instanceof StoreError, true);
});

Deno.test("a listing that fails is an error, never an empty account", async () => {
  const storage = storageWith([`${ALICE}/page-1/original.jpg`], { failList: true });
  const error = await thrownBy(() => createAccountStore(KEYS, storage.fetch).removeFiles("photos", ALICE));
  assertEquals(error instanceof StoreError, true);
  assertEquals(storage.removals, []);
});

Deno.test("erasing the files of an account works in the bucket it is given, ALTO files and models included [14]", async () => {
  for (const bucket of ["alto", "models"] as const) {
    const storage = storageWith([`${ALICE}/page-1/a.xml`, `${ALICE}/1.safetensors`, `${BOB}/page-1/a.xml`], {}, bucket);
    await createAccountStore(KEYS, storage.fetch).removeFiles(bucket, ALICE);
    assertEquals([...storage.files], [`${BOB}/page-1/a.xml`]);
    assertEquals(storage.headers.every((headers) => headers.get("authorization") === "Bearer secret-key"), true);
  }
});

Deno.test("erasing the files of an account never reaches another bucket than the one it is given [14]", async () => {
  const storage = storageWith([`${ALICE}/page-1/original.jpg`], {}, "photos");
  const error = await thrownBy(() => createAccountStore(KEYS, storage.fetch).removeFiles("alto", ALICE));
  assertEquals(error instanceof StoreError, true);
  assertEquals(storage.files.size, 1);
});

Deno.test("deleting the account calls the administration of accounts with the id given, as the service, and no soft delete", async () => {
  const { fetch, calls } = stub(() => ({}));
  await createAccountStore(KEYS, fetch).deleteUser(ALICE);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "DELETE");
  assertEquals(calls[0].url.pathname, `/auth/v1/admin/users/${ALICE}`);
  assertEquals(calls[0].headers.get("authorization"), "Bearer secret-key");
  assertEquals((calls[0].body as { should_soft_delete?: boolean }).should_soft_delete, false);
});

Deno.test("an account that cannot be deleted is an error", async () => {
  const error = await thrownBy(() => createAccountStore(KEYS, answer(500, { message: "boom" })).deleteUser(ALICE));
  assertEquals(error instanceof StoreError, true);
});

Deno.test("listing the photos of an account walks every folder and goes on page after page [9]", async () => {
  const storage = storageWith([...ALICE_FILES, `${BOB}/page-1/original.jpg`]);
  const paths = await createTransferStore(KEYS, storage.fetch).listFiles("photos", ALICE);
  assertEquals([...paths].sort(), [...ALICE_FILES].sort());
  const offsets = storage.lists.filter((list) => list.prefix === ALICE).map((list) => list.offset);
  assertEquals(offsets.slice(0, 3), [0, 100, 200]);
  assertEquals(storage.lists.every((list) => list.prefix === ALICE || list.prefix.startsWith(`${ALICE}/`)), true);
  assertEquals(storage.headers.every((headers) => headers.get("authorization") === "Bearer secret-key"), true);
});

Deno.test("an account with no file lists no photo [9]", async () => {
  const storage = storageWith([`${BOB}/page-1/original.jpg`]);
  assertEquals(await createTransferStore(KEYS, storage.fetch).listFiles("photos", ALICE), []);
});

Deno.test("a listing that fails is an error, never an empty account [9]", async () => {
  const storage = storageWith([`${ALICE}/page-1/original.jpg`], { failList: true });
  assertEquals((await thrownBy(() => createTransferStore(KEYS, storage.fetch).listFiles("photos", ALICE))) instanceof StoreError, true);
});

Deno.test("copying a photo asks the storage to copy the old path to the new path, in the same bucket, as the service [9]", async () => {
  const from = `${ALICE}/page-1/original.jpg`;
  const to = `${BOB}/page-1/original.jpg`;
  const storage = storageWith([from]);
  await createTransferStore(KEYS, storage.fetch).copyFile("photos", from, to);
  assertEquals(storage.copies, [{ bucketId: "photos", sourceKey: from, destinationKey: to }]);
  assertEquals(storage.files.has(to), true);
  assertEquals(storage.files.has(from), true);
  assertEquals(storage.headers[0].get("authorization"), "Bearer secret-key");
});

Deno.test("listing and copying the ALTO files of an account happen in the alto bucket [14]", async () => {
  const from = `${ALICE}/page-1/a.xml`;
  const to = `${BOB}/page-1/a.xml`;
  const storage = storageWith([from], {}, "alto");
  const store = createTransferStore(KEYS, storage.fetch);
  assertEquals(await store.listFiles("alto", ALICE), [from]);
  await store.copyFile("alto", from, to);
  assertEquals(storage.copies, [{ bucketId: "alto", sourceKey: from, destinationKey: to }]);
  assertEquals(await store.listFiles("alto", BOB), [to]);
});

Deno.test("a photo that is already at its new path counts as copied [9]", async () => {
  const from = `${ALICE}/page-1/original.jpg`;
  const to = `${BOB}/page-1/original.jpg`;
  const storage = storageWith([from, to]);
  await createTransferStore(KEYS, storage.fetch).copyFile("photos", from, to);
  assertEquals(storage.copies.length, 1);
});

Deno.test("a copy that fails for another reason is an error [9]", async () => {
  const from = `${ALICE}/page-1/original.jpg`;
  const failing = storageWith([from], { failCopy: true });
  assertEquals((await thrownBy(() => createTransferStore(KEYS, failing.fetch).copyFile("photos", from, `${BOB}/page-1/original.jpg`))) instanceof StoreError, true);
  const missing = storageWith([]);
  assertEquals((await thrownBy(() => createTransferStore(KEYS, missing.fetch).copyFile("photos", from, `${BOB}/page-1/original.jpg`))) instanceof StoreError, true);
});

Deno.test("moving the rows calls transfer_account_rows with the two ids alone, as the service, and reads the counts back [9]", async () => {
  const { fetch, calls } = stub(() => [{ pages: 3, notebooks_merged: 1 }]);
  const result = await createTransferStore(KEYS, fetch).moveRows(ALICE, BOB);
  assertEquals(result, { ok: true, pages: 3, notebooksMerged: 1 });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/transfer_account_rows");
  assertEquals(calls[0].body, { p_from: ALICE, p_to: BOB });
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
});

Deno.test("a page that is being read refuses the move, and that is an answer, not an error [8]", async () => {
  const store = createTransferStore(KEYS, answer(400, { code: "P0001", details: null, hint: null, message: "page_processing" }));
  assertEquals(await store.moveRows(ALICE, BOB), { ok: false, reason: "page_processing" });
});

Deno.test("any other refusal or failure of the move is an error [8]", async () => {
  for (const message of ["not_anonymous", "same_account", "target_anonymous", "account_not_found", "boom"]) {
    const store = createTransferStore(KEYS, answer(400, { code: "P0001", details: null, hint: null, message }));
    assertEquals((await thrownBy(() => store.moveRows(ALICE, BOB))) instanceof StoreError, true);
  }
  const broken = createTransferStore(KEYS, answer(500, { message: "boom" }));
  assertEquals((await thrownBy(() => broken.moveRows(ALICE, BOB))) instanceof StoreError, true);
});

Deno.test("an answer of the move that holds no counts is an error, never a pass [9]", async () => {
  for (const body of [[], [{ pages: "three", notebooks_merged: 0 }], [{ pages: 1 }], {}]) {
    const store = createTransferStore(KEYS, answer(200, body));
    assertEquals((await thrownBy(() => store.moveRows(ALICE, BOB))) instanceof StoreError, true);
  }
});

Deno.test("looking for a page that is being read filters by owner and by the processing state [8]", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  assertEquals(await createTransferStore(KEYS, fetch).hasProcessingPage(ALICE), true);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.pathname, "/rest/v1/pages");
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.processing");
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
});

Deno.test("no page being read gives false, and a failed lookup is an error, never false [8]", async () => {
  assertEquals(await createTransferStore(KEYS, answer(200, [])).hasProcessingPage(ALICE), false);
  assertEquals((await thrownBy(() => createTransferStore(KEYS, answer(500, { message: "boom" })).hasProcessingPage(ALICE))) instanceof StoreError, true);
});

async function storeError(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
  } catch (error) {
    return error instanceof StoreError;
  }
  return false;
}

Deno.test("the switch to math calls set_page_math with the page and its owner, as the service, and reads the ALTO path back [9]", async () => {
  const path = `${ALICE}/${PAGE_ID}/a-0123456789abcdef0123456789abcdef.xml`;
  const { fetch, calls } = stub(() => [{ outcome: "switched", alto_path: path }]);
  assertEquals(await createPageTypeStore(KEYS, fetch).setMath(ALICE, PAGE_ID), { outcome: "switched", altoPath: path });
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/set_page_math");
  assertEquals(calls[0].body, { p_page_id: PAGE_ID, p_user_id: ALICE });
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
});

Deno.test("the switch to text calls set_page_text and reads B1 back [9]", async () => {
  const { fetch, calls } = stub(() => [{ outcome: "switched", b1: "Bonjour" }]);
  assertEquals(await createPageTypeStore(KEYS, fetch).setText(BOB, PAGE_ID), { outcome: "switched", b1: "Bonjour" });
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/set_page_text");
  assertEquals(calls[0].body, { p_page_id: PAGE_ID, p_user_id: BOB });
});

Deno.test("a refusal of a switch is read back as such", async () => {
  for (const outcome of ["unchanged", "page_not_found", "page_not_read", "unsupported_script", "no_reading"] as const) {
    const { fetch } = stub(() => [{ outcome, b1: null }]);
    assertEquals(await createPageTypeStore(KEYS, fetch).setText(ALICE, PAGE_ID), { outcome, b1: null }, outcome);
  }
});

Deno.test("an unknown outcome of a switch, or one of another shape, is an error, never a pass", async () => {
  for (const answer of [[{ outcome: "something_new", alto_path: null }], [], [{ outcome: "switched", alto_path: 3 }], { outcome: "switched" }]) {
    const { fetch } = stub(() => answer);
    assertEquals(await storeError(() => createPageTypeStore(KEYS, fetch).setMath(ALICE, PAGE_ID)), true, JSON.stringify(answer));
  }
});

Deno.test("a switch to text that answers no B1 means no A to read again", async () => {
  const { fetch } = stub(() => [{ outcome: "switched", b1: null }]);
  assertEquals(await createPageTypeStore(KEYS, fetch).setText(ALICE, PAGE_ID), { outcome: "switched", b1: null });
});

Deno.test("the ALTO file of the page is removed from the alto bucket by its path", async () => {
  const path = `${ALICE}/${PAGE_ID}/a.xml`;
  const { fetch, calls } = stub(() => [{ name: path }]);
  await createPageTypeStore(KEYS, fetch).removeAlto(path);
  assertEquals(calls[0].method, "DELETE");
  assertEquals(calls[0].url.pathname, "/storage/v1/object/alto");
  assertEquals(calls[0].body, { prefixes: [path] });
});
