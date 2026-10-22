import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleEditPage } from "../edit-page/handler.ts";
import type { EditOutcome, EditStore } from "../_shared/ports.ts";
import { createEditStore, StoreError } from "../_shared/supabase-adapters.ts";
import { ALICE, BOB, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

const CANARY_TEXT = "PANDA-CANARY-PAGE-TEXT";

type Sent = { userId: string; pageId: string; text: string; words: unknown; gaps: unknown };

function fakeStore(outcome: EditOutcome | Error = "edited"): { store: EditStore; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    store: {
      editPage: (userId, pageId, text, words, gaps) => {
        sent.push({ userId, pageId, text, words, gaps });
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    },
  };
}

const VALID = { page_id: PAGE_ID, text: "Bonjour Pierre", words: [{ token_index: 1, text: "Pierre" }], gaps: [{ gap_index: 2, text: " ok" }] };

function call(world: World, store: EditStore, token: string | null, body: unknown, method = "POST"): Promise<Response> {
  return handleEditPage(post(token, body, method), { auth: world.authPort(), edits: store, log: world.logger() });
}

Deno.test("an edit of the owner is passed on with the owner of the token alone and answers 200 [6]", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  const response = await call(world, store, TOKEN_ALICE, VALID);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { edited: true });
  assertEquals(sent, [{ userId: ALICE, pageId: PAGE_ID, text: "Bonjour Pierre", words: VALID.words, gaps: VALID.gaps }]);
});

Deno.test("the owner is never read from the request [5]", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  await call(world, store, TOKEN_BOB, VALID);
  assertEquals(sent[0].userId, BOB);
  const response = await call(world, store, TOKEN_ALICE, { ...VALID, user_id: BOB });
  assertEquals(response.status, 400);
  assertEquals(sent.length, 1);
});

Deno.test("only a POST with a good token is admitted", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  assertEquals((await call(world, store, TOKEN_ALICE, VALID, "GET")).status, 405);
  assertEquals((await call(world, store, null, VALID)).status, 401);
  assertEquals((await call(world, store, "unknown", VALID)).status, 401);
  assertEquals(sent.length, 0);
});

Deno.test("a body that is not exactly what is expected is refused before any call [6]", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  const long = "x".repeat(200_001);
  const bodies: unknown[] = [
    null,
    [],
    "text",
    {},
    { ...VALID, page_id: "not-a-uuid" },
    { ...VALID, page_id: undefined },
    { ...VALID, text: 3 },
    { ...VALID, text: long },
    { ...VALID, words: {} },
    { ...VALID, gaps: null },
    { ...VALID, extra: 1 },
    { ...VALID, words: [{ token_index: 1 }] },
    { ...VALID, words: [{ token_index: 1, text: "a", extra: 1 }] },
    { ...VALID, words: [{ token_index: -1, text: "a" }] },
    { ...VALID, words: [{ token_index: 1.5, text: "a" }] },
    { ...VALID, words: [{ token_index: "1", text: "a" }] },
    { ...VALID, words: [{ token_index: 1, text: 4 }] },
    { ...VALID, words: [{ token_index: 1, text: "x".repeat(101) }] },
    { ...VALID, words: [{ token_index: 1, text: "a" }, { token_index: 1, text: "b" }] },
    { ...VALID, words: Array.from({ length: 2001 }, (_, index) => ({ token_index: index, text: "a" })) },
    { ...VALID, gaps: [{ gap_index: 1, text: "a" }, { gap_index: 1, text: "b" }] },
    { ...VALID, gaps: [{ gap_index: -1, text: "a" }] },
    { ...VALID, gaps: [{ gap_index: 1 }] },
    { ...VALID, gaps: [{ gap_index: 1, text: "a", extra: 1 }] },
    { ...VALID, gaps: [{ gap_index: 1, text: 2 }] },
    { ...VALID, text: "ab", gaps: [{ gap_index: 0, text: "abc" }] },
    { ...VALID, gaps: Array.from({ length: 20_002 }, (_, index) => ({ gap_index: index, text: "" })) },
    { ...VALID, text: "a" + String.fromCharCode(0) + "b" },
    { ...VALID, text: "a" + String.fromCharCode(0xd800) + "b" },
    { ...VALID, text: "a" + String.fromCharCode(0xdc00) },
    { ...VALID, words: [{ token_index: 1, text: "a" + String.fromCharCode(0) }] },
    { ...VALID, words: [{ token_index: 1, text: String.fromCharCode(0xd83d) }] },
    { ...VALID, gaps: [{ gap_index: 1, text: String.fromCharCode(0) }] },
    { ...VALID, gaps: [{ gap_index: 1, text: String.fromCharCode(0xde00) }] },
  ];
  for (const body of bodies) {
    const response = await call(world, store, TOKEN_ALICE, body);
    assertEquals(response.status, 400, JSON.stringify(body)?.slice(0, 80));
    assertEquals((await readJson(response)).error, "invalid_request");
  }
  const broken = await handleEditPage(
    new Request("http://functions.test/fn", { method: "POST", headers: { authorization: `Bearer ${TOKEN_ALICE}` }, body: "{" }),
    { auth: world.authPort(), edits: store, log: world.logger() },
  );
  assertEquals(broken.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("a body that declares more than two megabytes is refused before it is read", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  const request = new Request("http://functions.test/fn", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN_ALICE}`, "content-length": "2000001" },
    body: JSON.stringify(VALID),
  });
  const response = await handleEditPage(request, { auth: world.authPort(), edits: store, log: world.logger() });
  assertEquals(response.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("a body of more than two megabytes is refused", async () => {
  const world = new World();
  const { store, sent } = fakeStore();
  const response = await call(world, store, TOKEN_ALICE, JSON.stringify({ ...VALID, text: "x".repeat(2_100_000) }));
  assertEquals(response.status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("every refusal of the database has its own answer [6]", async () => {
  const world = new World();
  const expected: [EditOutcome, number, string][] = [
    ["page_not_found", 404, "page_not_found"],
    ["page_not_read", 409, "page_not_read"],
    ["unsupported_script", 409, "unsupported_script"],
    ["not_editable", 409, "not_editable"],
    ["text_mismatch", 409, "text_changed"],
    ["invalid_edit", 422, "invalid_edit"],
  ];
  for (const [outcome, status, code] of expected) {
    const response = await call(world, fakeStore(outcome).store, TOKEN_ALICE, VALID);
    assertEquals(response.status, status, outcome);
    assertEquals(await readJson(response), { error: code }, outcome);
  }
});

Deno.test("a failure of the store is a 500 that says nothing", async () => {
  const world = new World();
  const response = await call(world, fakeStore(new StoreError("editPage")).store, TOKEN_ALICE, VALID);
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
});

Deno.test("the logs name a page at most, never a text [6]", async () => {
  const world = new World();
  const body = { ...VALID, text: CANARY_TEXT, words: [{ token_index: 1, text: CANARY_TEXT }], gaps: [{ gap_index: 0, text: CANARY_TEXT }] };
  await call(world, fakeStore().store, TOKEN_ALICE, body);
  await call(world, fakeStore("invalid_edit").store, TOKEN_ALICE, body);
  await call(world, fakeStore(new Error(CANARY_TEXT)).store, TOKEN_ALICE, body);
  assert(world.logs.length >= 3);
  assert(world.logs.some((record) => record.event === "page_edited" && record.fields.pageId === PAGE_ID));
  assert(!JSON.stringify(world.logs).includes(CANARY_TEXT));
});

type Call = { url: URL; headers: Headers; body: unknown };

function stub(answer: unknown): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
  };
  return { fetch: fetcher as typeof fetch, calls };
}

const KEYS = { url: "http://db.test", publishableKey: "publishable-key", secretKey: "secret-key" };

Deno.test("edit_page is called with the page, the owner, the text, the words and the gaps, as the service [5][6]", async () => {
  const { fetch, calls } = stub("edited");
  const outcome = await createEditStore(KEYS, fetch).editPage(ALICE, PAGE_ID, "Bonjour", [{ token_index: 1, text: "a" }], [{ gap_index: 0, text: "b" }]);
  assertEquals(outcome, "edited");
  assertEquals(calls[0].url.pathname, "/rest/v1/rpc/edit_page");
  assertEquals(calls[0].headers.get("apikey"), "secret-key");
  assertEquals(calls[0].body, {
    p_page_id: PAGE_ID,
    p_user_id: ALICE,
    p_text: "Bonjour",
    p_words: [{ token_index: 1, text: "a" }],
    p_gaps: [{ gap_index: 0, text: "b" }],
  });
});

Deno.test("every outcome of edit_page is read back, and anything else is an error", async () => {
  for (const outcome of ["edited", "page_not_found", "page_not_read", "unsupported_script", "not_editable", "text_mismatch", "invalid_edit"]) {
    assertEquals(await createEditStore(KEYS, stub(outcome).fetch).editPage(ALICE, PAGE_ID, "", [], []), outcome);
  }
  for (const answer of ["something_new", null, 3, [], { outcome: "edited" }]) {
    let failed = false;
    try {
      await createEditStore(KEYS, stub(answer).fetch).editPage(ALICE, PAGE_ID, "", [], []);
    } catch (error) {
      failed = error instanceof StoreError;
    }
    assertEquals(failed, true, JSON.stringify(answer));
  }
});
