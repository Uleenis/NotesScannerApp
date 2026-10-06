import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GeminiReading } from "../../_shared/gemini.ts";
import { GeminiFailure } from "../../_shared/gemini.ts";
import { createLogger } from "../../_shared/log.ts";
import { createAuth, createCallerStore, createServerStore, createServiceReader, readKeys } from "../../_shared/supabase-adapters.ts";
import { handlePreparePage } from "../../prepare-page/handler.ts";
import { handleReadPage } from "../../read-page/handler.ts";
import { handleRelaunchPage } from "../../relaunch-page/handler.ts";
import type { PreparePageDeps, ReadPageDeps, RelaunchPageDeps } from "../../_shared/ports.ts";

const MANUAL_SECRET = "manual-".repeat(7);

const keys = readKeys((name) => Deno.env.get(name));
const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PAGE_TEXT = "A line from the fake reading\nand a second one";

type Account = { id: string; token: string; client: SupabaseClient };

const admin: SupabaseClient = createClient(keys.url, keys.secretKey, { auth: NO_SESSION });
const created: string[] = [];
const uploaded: string[] = [];
const logLines: string[] = [];

let geminiOutcomes: (GeminiReading | Error)[] = [];
let geminiCalls = 0;

const reading: GeminiReading = { text: PAGE_TEXT, modelVersion: "gemini-3.6-flash-manual", inputTokens: 900, outputTokens: 40, thoughtsTokens: 0 };

const readDeps: ReadPageDeps = {
  auth: createAuth(keys),
  forCaller: (token) => createCallerStore(keys, token),
  server: createServerStore(keys),
  gemini: () => {
    geminiCalls++;
    const outcome = geminiOutcomes.shift() ?? reading;
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  },
  clock: { now: () => Date.now() },
  log: createLogger((line) => logLines.push(line)),
};

const relaunchDeps: RelaunchPageDeps = {
  secret: MANUAL_SECRET,
  reader: createServiceReader(keys),
  server: readDeps.server,
  gemini: readDeps.gemini,
  clock: readDeps.clock,
  log: readDeps.log,
};

function relaunchRequest(pageId: string, secret: string = MANUAL_SECRET): Request {
  return new Request("http://functions.test/fn", {
    method: "POST",
    headers: { "x-relaunch-secret": secret, "content-type": "application/json" },
    body: JSON.stringify({ page_id: pageId }),
  });
}

const prepareDeps: PreparePageDeps = { auth: readDeps.auth, forCaller: readDeps.forCaller, server: readDeps.server, log: readDeps.log };

async function account(): Promise<Account> {
  const client = createClient(keys.url, keys.publishableKey, { auth: NO_SESSION });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) throw new Error("anonymous sign-in failed");
  created.push(data.user.id);
  const authed = createClient(keys.url, keys.publishableKey, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { id: data.user.id, token: data.session.access_token, client: authed };
}

async function newPage(who: Account, notebookId?: string): Promise<{ pageId: string; notebookId: string }> {
  let notebook = notebookId;
  if (!notebook) {
    const { data, error } = await who.client.from("notebooks").insert({ name: `manual ${crypto.randomUUID()}` }).select("id").single();
    if (error) throw new Error("notebook insert failed");
    notebook = data.id as string;
  }
  const { data, error } = await who.client.from("pages").insert({ notebook_id: notebook }).select("id").single();
  if (error) throw new Error("page insert failed");
  return { pageId: data.id as string, notebookId: notebook };
}

function request(token: string, pageId: string): Request {
  return new Request("http://functions.test/fn", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ page_id: pageId }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function prepareAndUpload(who: Account, pageId: string, bytes: Uint8Array = JPEG): Promise<void> {
  const response = await handlePreparePage(request(who.token, pageId), prepareDeps);
  const answer = await body(response);
  assertEquals(response.status, 200);
  const path = answer.path as string;
  assertEquals(path, `${who.id}/${pageId}/original.jpg`);
  const { error } = await who.client.storage.from("photos").uploadToSignedUrl(path, answer.token as string, bytes, { contentType: "image/jpeg" });
  if (error) throw new Error("upload failed");
  uploaded.push(path);
}

async function pageRow(pageId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("pages").select("*").eq("id", pageId).single();
  if (error) throw new Error("page select failed");
  return data as Record<string, unknown>;
}

async function rows(table: string, pageId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin.from(table).select("*").eq("page_id", pageId);
  if (error) throw new Error("select failed");
  return data as Record<string, unknown>[];
}

Deno.test({
  name: "the real adapters on the local database",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    try {
      await t.step("a page goes from queued to read, with everything written once and by the server", async () => {
        const alice = await account();
        const bob = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiCalls = 0;
        const response = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(response.status, 200);
        assertEquals(await body(response), { status: "read" });
        assertEquals(geminiCalls, 1);
        const page = await pageRow(pageId);
        assertEquals(page.status, "read");
        assertEquals(page.queue_reason, null);
        assert(typeof page.read_at === "string");
        const readings = await rows("readings", pageId);
        assertEquals(readings.length, 1);
        assertEquals(readings[0].label, "B1");
        assertEquals(readings[0].raw_text, PAGE_TEXT);
        assertEquals(readings[0].model, "gemini-3.6-flash");
        assertEquals(readings[0].prompt_version, "v0");
        assertEquals(readings[0].thinking_budget, 0);
        assertEquals(readings[0].input_tokens, 900);
        assertEquals(readings[0].output_tokens, 40);
        assertEquals(readings[0].user_id, alice.id);
        const texts = await rows("page_texts", pageId);
        assertEquals(texts.length, 1);
        assertEquals(texts[0].text, PAGE_TEXT);
        assertEquals(texts[0].pipeline_version, "b1-raw");
        assertEquals((await rows("page_charges", pageId)).length, 1);
        const images = await rows("page_images", pageId);
        assertEquals(images.length, 1);
        assertEquals(images[0].kind, "original");
        assertEquals(images[0].storage_path, `${alice.id}/${pageId}/original.jpg`);
        const own = await alice.client.from("page_texts").select("text").eq("page_id", pageId);
        assertEquals(own.data?.length, 1);
        const other = await bob.client.from("page_texts").select("text").eq("page_id", pageId);
        assertEquals(other.data?.length, 0);
      });

      await t.step("a second call on a page already read is refused and counts nothing", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        await handleReadPage(request(alice.token, pageId), readDeps);
        geminiCalls = 0;
        const response = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(response.status, 409);
        assertEquals(await body(response), { error: "page_already_read" });
        assertEquals(geminiCalls, 0);
        assertEquals((await rows("page_charges", pageId)).length, 1);
      });

      await t.step("another user cannot prepare or read a page, and nothing is charged", async () => {
        const alice = await account();
        const bob = await account();
        const { pageId } = await newPage(alice);
        const prepare = await handlePreparePage(request(bob.token, pageId), prepareDeps);
        assertEquals(prepare.status, 404);
        await prepareAndUpload(alice, pageId);
        geminiCalls = 0;
        const read = await handleReadPage(request(bob.token, pageId), readDeps);
        assertEquals(read.status, 404);
        assertEquals(geminiCalls, 0);
        assertEquals((await rows("page_charges", pageId)).length, 0);
        assertEquals((await pageRow(pageId)).status, "queued");
      });

      await t.step("two failures queue the page with read_error, keep the photo, and a later reading charges nothing more", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
        geminiCalls = 0;
        const failed = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(await body(failed), { status: "queued", queue_reason: "read_error" });
        assertEquals(geminiCalls, 2);
        const page = await pageRow(pageId);
        assertEquals(page.status, "queued");
        assertEquals(page.queue_reason, "read_error");
        assertEquals(page.retry_count, 0);
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await rows("readings", pageId)).length, 0);
        const still = await alice.client.storage.from("photos").info(`${alice.id}/${pageId}/original.jpg`);
        assert(!still.error);
        const retried = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(await body(retried), { status: "read" });
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await pageRow(pageId)).queue_reason, null);
        assertEquals((await rows("page_images", pageId)).length, 1);
      });

      await t.step("a photo that says JPEG but is not one is refused before any charge", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId, PNG);
        geminiCalls = 0;
        const response = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(response.status, 422);
        assertEquals(await body(response), { error: "photo_not_jpeg" });
        assertEquals(geminiCalls, 0);
        assertEquals((await rows("page_charges", pageId)).length, 0);
        assertEquals((await pageRow(pageId)).status, "queued");
      });

      await t.step("a page without a photo is refused, and prepare-page refuses once the photo is there", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        const missing = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(missing.status, 422);
        assertEquals(await body(missing), { error: "photo_missing" });
        await prepareAndUpload(alice, pageId);
        const again = await handlePreparePage(request(alice.token, pageId), prepareDeps);
        assertEquals(again.status, 409);
        assertEquals(await body(again), { error: "photo_exists" });
      });

      await t.step("two calls at once charge once and read once", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiCalls = 0;
        const [a, b] = await Promise.all([
          handleReadPage(request(alice.token, pageId), readDeps),
          handleReadPage(request(alice.token, pageId), readDeps),
        ]);
        assertEquals([a.status, b.status].sort(), [200, 409]);
        assertEquals(geminiCalls, 1);
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await rows("readings", pageId)).length, 1);
        assertEquals((await pageRow(pageId)).status, "read");
      });

      await t.step("an anonymous account is refused its fourth page by prepare-page and by read-page", async () => {
        const carol = await account();
        const { pageId: first, notebookId } = await newPage(carol);
        const pages = [first];
        for (let i = 0; i < 3; i++) pages.push((await newPage(carol, notebookId)).pageId);
        for (const pageId of pages.slice(0, 3)) {
          await prepareAndUpload(carol, pageId);
          const response = await handleReadPage(request(carol.token, pageId), readDeps);
          assertEquals(response.status, 200);
        }
        const fourth = pages[3];
        const prepare = await handlePreparePage(request(carol.token, fourth), prepareDeps);
        assertEquals(prepare.status, 403);
        assertEquals(await body(prepare), { error: "anonymous_limit" });
        const { data } = await admin.storage.from("photos").createSignedUploadUrl(`${carol.id}/${fourth}/original.jpg`);
        assert(data);
        await admin.storage.from("photos").uploadToSignedUrl(`${carol.id}/${fourth}/original.jpg`, data.token, JPEG, { contentType: "image/jpeg" });
        uploaded.push(`${carol.id}/${fourth}/original.jpg`);
        geminiCalls = 0;
        const read = await handleReadPage(request(carol.token, fourth), readDeps);
        assertEquals(read.status, 403);
        assertEquals(await body(read), { error: "anonymous_limit" });
        assertEquals(geminiCalls, 0);
        assertEquals((await pageRow(fourth)).status, "queued");
      });

      await t.step("the server store refuses to touch a page in the name of another user", async () => {
        const alice = await account();
        const bob = await account();
        const { pageId } = await newPage(alice);
        const server = createServerStore(keys);
        assertEquals(await server.claimForReading(bob.id, pageId, { status: "queued", queueReason: null, retryCount: 0 }), false);
        assertEquals((await pageRow(pageId)).status, "queued");
        assertEquals(await server.claimForReading(alice.id, pageId, { status: "queued", queueReason: null, retryCount: 0 }), true);
        let refused = 0;
        const attempts = [
          () => server.markRead(bob.id, pageId, new Date().toISOString()),
          () => server.releaseToQueue(bob.id, pageId, "read_error", 1),
          () => server.markFailed(bob.id, pageId, 3),
          () => server.insertReading(bob.id, pageId, {
            label: "B1",
            rawText: "x",
            model: "m",
            modelVersion: "m",
            promptVersion: "v0",
            thinkingBudget: 0,
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          }),
          () => server.upsertPageText(bob.id, pageId, "x", "b1-raw"),
          () => server.recordOriginalImage(bob.id, pageId, `${bob.id}/${pageId}/original.jpg`),
        ];
        for (const attempt of attempts) {
          try {
            await attempt();
          } catch {
            refused++;
          }
        }
        assertEquals(refused, attempts.length);
        const page = await pageRow(pageId);
        assertEquals(page.status, "processing");
        assertEquals((await rows("readings", pageId)).length, 0);
        assertEquals((await rows("page_texts", pageId)).length, 0);
        assertEquals((await rows("page_images", pageId)).length, 0);
      });

      await t.step("a page that always fails is read four times at most, charged once, and then fails for good", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiCalls = 0;
        const answers: unknown[] = [];
        const counts: unknown[] = [];
        for (let i = 0; i < 4; i++) {
          geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
          answers.push(await body(await handleReadPage(request(alice.token, pageId), readDeps)));
          counts.push((await pageRow(pageId)).retry_count);
        }
        assertEquals(answers, [
          { status: "queued", queue_reason: "read_error" },
          { status: "queued", queue_reason: "read_error" },
          { status: "queued", queue_reason: "read_error" },
          { status: "failed" },
        ]);
        assertEquals(counts, [0, 1, 2, 3]);
        const page = await pageRow(pageId);
        assertEquals(page.status, "failed");
        assertEquals(page.queue_reason, null);
        assertEquals(geminiCalls, 8);
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await pageRow(pageId)).manual_relaunched_at, null);
        geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
        const fifth = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(await body(fifth), { status: "failed" });
        assertEquals(geminiCalls, 10);
        const relaunched = await pageRow(pageId);
        assertEquals(relaunched.status, "failed");
        assertEquals(relaunched.retry_count, 3);
        assert(typeof relaunched.manual_relaunched_at === "string");
        const sixth = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(sixth.status, 429);
        assertEquals(await body(sixth), { error: "relaunch_too_soon" });
        assertEquals(geminiCalls, 10);
        assertEquals((await rows("page_charges", pageId)).length, 1);
        const still = await alice.client.storage.from("photos").info(`${alice.id}/${pageId}/original.jpg`);
        assert(!still.error);
        await admin.from("pages").update({ manual_relaunched_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() }).eq("id", pageId);
        const seventh = await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals(await body(seventh), { status: "read" });
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await pageRow(pageId)).status, "read");
      });

      await t.step("only the owner of a failed page can relaunch it", async () => {
        const alice = await account();
        const bob = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        await handleReadPage(request(alice.token, pageId), readDeps);
        await admin.from("pages").update({ status: "failed", retry_count: 3 }).eq("id", pageId);
        geminiCalls = 0;
        const other = await handleReadPage(request(bob.token, pageId), readDeps);
        assertEquals(other.status, 404);
        assertEquals(geminiCalls, 0);
        assertEquals((await pageRow(pageId)).status, "failed");
        assertEquals((await pageRow(pageId)).manual_relaunched_at, null);
      });

      await t.step("the scheduler door refuses a wrong secret and a user token, and reads a page queued for read_error once", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
        await handleReadPage(request(alice.token, pageId), readDeps);
        assertEquals((await pageRow(pageId)).queue_reason, "read_error");
        geminiCalls = 0;
        assertEquals((await handleRelaunchPage(relaunchRequest(pageId, "wrong"), relaunchDeps)).status, 401);
        assertEquals((await handleRelaunchPage(relaunchRequest(pageId, alice.token), relaunchDeps)).status, 401);
        assertEquals(geminiCalls, 0);
        const [a, b] = await Promise.all([
          handleRelaunchPage(relaunchRequest(pageId), relaunchDeps),
          handleRelaunchPage(relaunchRequest(pageId), relaunchDeps),
        ]);
        assertEquals([a.status, b.status].sort(), [200, 409]);
        assertEquals(geminiCalls, 1);
        assertEquals((await pageRow(pageId)).status, "read");
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await rows("readings", pageId)).length, 1);
        assertEquals((await rows("page_images", pageId)).length, 1);
      });

      await t.step("the scheduler door counts three failed relaunches and then fails the page, with one charge", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
        await handleReadPage(request(alice.token, pageId), readDeps);
        geminiCalls = 0;
        const answers: unknown[] = [];
        const counts: unknown[] = [];
        for (let i = 0; i < 4; i++) {
          geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
          const response = await handleRelaunchPage(relaunchRequest(pageId), relaunchDeps);
          answers.push(response.status === 200 ? await body(response) : { error: (await body(response)).error });
          counts.push((await pageRow(pageId)).retry_count);
        }
        assertEquals(answers, [
          { status: "queued", queue_reason: "read_error" },
          { status: "queued", queue_reason: "read_error" },
          { status: "failed" },
          { error: "page_not_relaunchable" },
        ]);
        assertEquals(counts, [1, 2, 3, 3]);
        assertEquals(geminiCalls, 6);
        assertEquals((await rows("page_charges", pageId)).length, 1);
        assertEquals((await pageRow(pageId)).status, "failed");
      });

      await t.step("the scheduler door fails a page whose photo is gone, without Gemini", async () => {
        const alice = await account();
        const { pageId } = await newPage(alice);
        await prepareAndUpload(alice, pageId);
        geminiOutcomes = [new GeminiFailure("http_error"), new GeminiFailure("timeout")];
        await handleReadPage(request(alice.token, pageId), readDeps);
        await admin.storage.from("photos").remove([`${alice.id}/${pageId}/original.jpg`]);
        geminiCalls = 0;
        const response = await handleRelaunchPage(relaunchRequest(pageId), relaunchDeps);
        assertEquals(response.status, 422);
        assertEquals(await body(response), { error: "photo_missing" });
        assertEquals(geminiCalls, 0);
        assertEquals((await pageRow(pageId)).status, "failed");
      });

      await t.step("the logs hold neither the text nor the upload token", () => {
        const all = logLines.join("\n");
        assert(all.length > 0);
        assert(!all.includes("fake reading"));
        assert(!all.includes("token"));
      });
    } finally {
      if (uploaded.length > 0) await admin.storage.from("photos").remove(uploaded);
      for (const id of created) await admin.auth.admin.deleteUser(id);
    }
  },
});
