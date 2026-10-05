import { assertEquals } from "jsr:@std/assert@1";
import { createAuth, createCallerStore, createServerStore, readKeys, StoreError } from "../_shared/supabase-adapters.ts";
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
  assertEquals(await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { queueReason: null, retryCount: 0 }), true);
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
  await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { queueReason: "read_error", retryCount: 2 });
  assertEquals(calls[0].url.searchParams.get("queue_reason"), "eq.read_error");
  assertEquals(calls[0].url.searchParams.get("retry_count"), "eq.2");
});

Deno.test("a claim that changes no row is not a claim", async () => {
  const { fetch } = stub(() => []);
  assertEquals(await createServerStore(KEYS, fetch).claimForReading(ALICE, PAGE_ID, { queueReason: null, retryCount: 0 }), false);
});

Deno.test("marking a page read filters by owner and by the processing state", async () => {
  const { fetch, calls } = stub(() => [{ id: PAGE_ID }]);
  await createServerStore(KEYS, fetch).markRead(ALICE, PAGE_ID, "2026-10-05T10:00:00.000Z");
  assertEquals(calls[0].url.searchParams.get("user_id"), `eq.${ALICE}`);
  assertEquals(calls[0].url.searchParams.get("status"), "eq.processing");
  assertEquals(calls[0].body, { status: "read", read_at: "2026-10-05T10:00:00.000Z", queue_reason: null });
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
  for (const write of [() => store.markRead(ALICE, PAGE_ID, "2026-10-05T10:00:00.000Z"), () => store.releaseToQueue(ALICE, PAGE_ID, "read_error", 1), () => store.markFailed(ALICE, PAGE_ID, 3)]) {
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
  const { fetch, calls } = stub(() => ({ id: PAGE_ID, user_id: ALICE, status: "queued", queue_reason: "read_error", retry_count: 2 }));
  const page = await createCallerStore(KEYS, "caller-token", fetch).getPage(PAGE_ID);
  assertEquals(page, { id: PAGE_ID, userId: ALICE, status: "queued", queueReason: "read_error", retryCount: 2 });
  assertEquals(calls[0].url.searchParams.get("select"), "id,user_id,status,queue_reason,retry_count");
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
  assertEquals(await auth.verify("token"), { userId: ALICE });
});
