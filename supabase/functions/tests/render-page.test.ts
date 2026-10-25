import { assert, assertEquals } from "jsr:@std/assert@1";
import { GeminiFailure } from "../_shared/gemini.ts";
import type { GeminiReading } from "../_shared/gemini.ts";
import type { RenderablePage, RenderStore, StoredRendering } from "../_shared/ports.ts";
import { fingerprint, MAX_RENDER_INPUT } from "../_shared/render-check.ts";
import { handleRenderPage } from "../render-page/handler.ts";
import { ALICE, BOB, CANARY_PAGE_TEXT, OTHER_PAGE_ID, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

const TEXT = `Les suites ${CANARY_PAGE_TEXT}\nUne suite converge si elle est bornée.`;
const GOOD = `# Les suites ${CANARY_PAGE_TEXT}\n\nUne suite converge si elle est **bornée**.`;

function reading(text: string): GeminiReading {
  return { text, modelVersion: "gemini-3.6-flash-001", inputTokens: 10, outputTokens: 12, thoughtsTokens: 0 };
}

class Fixture {
  readonly world = new World();
  readonly sent: string[] = [];
  readonly saved: { userId: string; pageId: string; rendering: StoredRendering }[] = [];
  readonly charged: string[] = [];
  readonly looked: { userId: string; pageId: string }[] = [];
  pages = new Map<string, RenderablePage>();
  allowed = 30;
  answers: (string | Error)[] = [GOOD];
  wait: Promise<void> | null = null;

  constructor(owner: string = ALICE, page: Partial<RenderablePage> = {}) {
    this.pages.set(`${owner}:${PAGE_ID}`, { status: "read", pageType: "text", text: TEXT, rendering: null, ...page });
  }

  store(): RenderStore {
    return {
      page: (userId, pageId) => {
        this.looked.push({ userId, pageId });
        return Promise.resolve(this.pages.get(`${userId}:${pageId}`) ?? null);
      },
      charge: (userId) => {
        this.charged.push(userId);
        if (this.allowed <= 0) return Promise.resolve({ allowed: false, used: 30 });
        this.allowed -= 1;
        return Promise.resolve({ allowed: true, used: 30 - this.allowed });
      },
      save: (userId, pageId, rendering) => {
        this.saved.push({ userId, pageId, rendering });
        const page = this.pages.get(`${userId}:${pageId}`);
        if (page) page.rendering = { text: rendering.text, basedOn: rendering.basedOn };
        return Promise.resolve();
      },
    };
  }

  async ask(body: unknown = { page_id: PAGE_ID }, token: string | null = TOKEN_ALICE, method = "POST"): Promise<Response> {
    return await handleRenderPage(post(token, body, method), {
      auth: this.world.authPort(),
      renders: this.store(),
      gemini: async (input) => {
        this.sent.push(input);
        if (this.wait) await this.wait;
        const answer = this.answers.length > 1 ? this.answers.shift()! : this.answers[0];
        if (answer instanceof Error) throw answer;
        return reading(answer);
      },
      clock: { now: () => 0 },
      log: this.world.logger(),
    });
  }

  events(): string[] {
    return this.world.logs.map((record) => record.event);
  }
}

Deno.test("Gemini gets the cleaned text alone and the rendering is stored for the owner of the token [2]", async () => {
  const fixture = new Fixture(ALICE, { text: `<u>Les suites</u> ${CANARY_PAGE_TEXT}\nUne suite converge si elle est bornée.` });
  const response = await fixture.ask();
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "ready", text: GOOD });
  assertEquals(fixture.sent, [TEXT]);
  assertEquals(fixture.saved.length, 1);
  assertEquals(fixture.saved[0].userId, ALICE);
  assertEquals(fixture.saved[0].pageId, PAGE_ID);
  assertEquals(fixture.saved[0].rendering, { text: GOOD, basedOn: await fingerprint(TEXT), model: "gemini-3.6-flash", promptVersion: "r1" });
  assertEquals(fixture.charged, [ALICE]);
});

Deno.test("the owner is the one of the verified token, never a field of the request [2]", async () => {
  const fixture = new Fixture(BOB);
  assertEquals((await fixture.ask({ page_id: PAGE_ID, user_id: BOB }, TOKEN_ALICE)).status, 400);
  assertEquals((await fixture.ask({ page_id: PAGE_ID }, TOKEN_ALICE)).status, 404);
  assertEquals(fixture.looked, [{ userId: ALICE, pageId: PAGE_ID }]);
  assertEquals(fixture.sent, []);
  assertEquals((await fixture.ask({ page_id: PAGE_ID }, TOKEN_BOB)).status, 200);
});

Deno.test("only a POST with a good token and a page id alone is admitted [2]", async () => {
  const fixture = new Fixture();
  assertEquals((await fixture.ask({ page_id: PAGE_ID }, TOKEN_ALICE, "GET")).status, 405);
  assertEquals((await fixture.ask({ page_id: PAGE_ID }, null)).status, 401);
  assertEquals((await fixture.ask({ page_id: PAGE_ID }, "unknown")).status, 401);
  assertEquals((await fixture.ask({})).status, 400);
  assertEquals((await fixture.ask({ page_id: "not-a-uuid" })).status, 400);
  assertEquals((await fixture.ask("not json")).status, 400);
  assertEquals((await fixture.ask([PAGE_ID])).status, 400);
  assertEquals(fixture.looked, []);
  assertEquals(fixture.sent, []);
});

Deno.test("a page that is not read, a missing page and a page of another script are refused with no charge and no call [2]", async () => {
  for (const status of ["queued", "processing", "failed"] as const) {
    const fixture = new Fixture(ALICE, { status });
    const response = await fixture.ask();
    assertEquals(response.status, 409);
    assertEquals(await readJson(response), { error: "page_not_read" });
    assertEquals(fixture.charged, []);
    assertEquals(fixture.sent, []);
  }
  const script = new Fixture(ALICE, { pageType: "unsupported_script" });
  assertEquals(await readJson(await script.ask()), { error: "unsupported_script" });
  const missing = new Fixture();
  assertEquals(await readJson(await missing.ask({ page_id: OTHER_PAGE_ID })), { error: "page_not_found" });
  for (const fixture of [script, missing]) {
    assertEquals(fixture.charged, []);
    assertEquals(fixture.sent, []);
  }
});

Deno.test("an empty text and a text over the bound are refused with no charge and no call [2]", async () => {
  const empty = new Fixture(ALICE, { text: " <u></u>\n " });
  assertEquals(await readJson(await empty.ask()), { error: "no_text" });
  const none = new Fixture(ALICE, { text: null });
  assertEquals((await none.ask()).status, 409);
  const longer = new Fixture(ALICE, { text: "a".repeat(MAX_RENDER_INPUT + 1) });
  const response = await longer.ask();
  assertEquals(response.status, 413);
  assertEquals(await readJson(response), { error: "text_too_long" });
  for (const fixture of [empty, none, longer]) {
    assertEquals(fixture.charged, []);
    assertEquals(fixture.sent, []);
  }
});

Deno.test("the length is counted after the tags are dropped [2]", async () => {
  const fixture = new Fixture(ALICE, { text: `<u>${"a".repeat(MAX_RENDER_INPUT)}</u>` });
  fixture.answers = ["a".repeat(MAX_RENDER_INPUT)];
  assertEquals((await fixture.ask()).status, 200);
  assertEquals(fixture.sent.length, 1);
});

Deno.test("the stored rendering is returned with no charge and no call while the text is the same [4]", async () => {
  const fixture = new Fixture(ALICE, { rendering: { text: "# Stocké", basedOn: await fingerprint(TEXT) } });
  assertEquals(await readJson(await fixture.ask()), { status: "ready", text: "# Stocké" });
  assertEquals(await readJson(await fixture.ask()), { status: "ready", text: "# Stocké" });
  assertEquals(fixture.sent, []);
  assertEquals(fixture.charged, []);
  assertEquals(fixture.saved, []);
});

Deno.test("a rendering is made once, reused until the text changes, then made again once [4]", async () => {
  const fixture = new Fixture();
  await fixture.ask();
  await fixture.ask();
  await fixture.ask();
  assertEquals(fixture.sent.length, 1);
  fixture.pages.get(`${ALICE}:${PAGE_ID}`)!.text = `${TEXT} corrigé`;
  fixture.answers = [`${GOOD} corrigé`];
  await fixture.ask();
  await fixture.ask();
  assertEquals(fixture.sent.length, 2);
  assertEquals(fixture.sent[1], `${TEXT} corrigé`);
  assertEquals(fixture.charged.length, 2);
});

Deno.test("two simultaneous calls on a page make one call to Gemini and one charge [2]", async () => {
  const fixture = new Fixture();
  let release: () => void = () => {};
  fixture.wait = new Promise((resolve) => {
    release = resolve;
  });
  const first = fixture.ask();
  const second = fixture.ask();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const [one, two] = await Promise.all([first, second]);
  assertEquals(await readJson(one), { status: "ready", text: GOOD });
  assertEquals(await readJson(two), { status: "ready", text: GOOD });
  assertEquals(fixture.sent.length, 1);
  assertEquals(fixture.charged.length, 1);
  assertEquals(fixture.saved.length, 1);
});

Deno.test("two simultaneous calls on two pages make two calls [2]", async () => {
  const fixture = new Fixture();
  fixture.pages.set(`${ALICE}:${OTHER_PAGE_ID}`, { status: "read", pageType: "text", text: TEXT, rendering: null });
  await Promise.all([fixture.ask({ page_id: PAGE_ID }), fixture.ask({ page_id: OTHER_PAGE_ID })]);
  assertEquals(fixture.sent.length, 2);
});

Deno.test("the 31st rendering of the day answers limit with no call, and the stored rendering is still served [2]", async () => {
  const fixture = new Fixture();
  fixture.allowed = 0;
  const response = await fixture.ask();
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "limit" });
  assertEquals(fixture.sent, []);
  assertEquals(fixture.saved, []);
  assert(fixture.events().includes("render_limit"));
  fixture.pages.get(`${ALICE}:${PAGE_ID}`)!.rendering = { text: "# Stocké", basedOn: await fingerprint(TEXT) };
  assertEquals(await readJson(await fixture.ask()), { status: "ready", text: "# Stocké" });
});

Deno.test("a rendering that touches the text is discarded, counted, logged by its reason and not stored [3]", async () => {
  const fixture = new Fixture();
  fixture.answers = [GOOD.replace("converge", "diverge")];
  assertEquals(await readJson(await fixture.ask()), { status: "discarded" });
  assertEquals(fixture.saved, []);
  assertEquals(fixture.charged, [ALICE]);
  assertEquals(fixture.sent.length, 1);
  assertEquals(fixture.world.logs.find((entry) => entry.event === "render_discarded")?.fields.code, "text_changed");
  fixture.answers = [`<b>${GOOD}</b>`];
  await fixture.ask();
  assertEquals(fixture.world.logs.filter((entry) => entry.event === "render_discarded").at(-1)?.fields.code, "refused_mark");
  assertEquals(fixture.charged.length, 2);
  assertEquals(fixture.saved, []);
});

Deno.test("a rendering over the bound is discarded before it reaches the store [3]", async () => {
  const fixture = new Fixture();
  fixture.answers = [`${GOOD}${" ".repeat(60_001)}`];
  assertEquals(await readJson(await fixture.ask()), { status: "discarded" });
  assertEquals(fixture.saved, []);
});

Deno.test("a failure of Gemini is tried once more, then answers failed with no storage [2]", async () => {
  const fixture = new Fixture();
  fixture.answers = [new GeminiFailure("http_error", 503), new GeminiFailure("timeout")];
  assertEquals(await readJson(await fixture.ask()), { status: "failed" });
  assertEquals(fixture.sent.length, 2);
  assertEquals(fixture.saved, []);
  assertEquals(fixture.charged.length, 1);
  assertEquals(fixture.world.logs.filter((entry) => entry.event === "gemini_attempt_failed").map((entry) => entry.fields.attempt), [1, 2]);
  assert(fixture.events().includes("render_failed"));
});

Deno.test("a failure followed by an answer gives the rendering [2]", async () => {
  const fixture = new Fixture();
  fixture.answers = [new GeminiFailure("network"), GOOD];
  assertEquals(await readJson(await fixture.ask()), { status: "ready", text: GOOD });
  assertEquals(fixture.sent.length, 2);
  assertEquals(fixture.charged.length, 1);
  assertEquals(fixture.saved.length, 1);
});

Deno.test("an error that is not a failure of Gemini answers 500 and frees the page for the next call [2]", async () => {
  const fixture = new Fixture();
  fixture.answers = [new TypeError("boom")];
  assertEquals((await fixture.ask()).status, 500);
  fixture.answers = [GOOD];
  assertEquals(await readJson(await fixture.ask()), { status: "ready", text: GOOD });
});

Deno.test("an error of the store answers 500 with nothing of the text in the logs [2]", async () => {
  const fixture = new Fixture();
  const store = fixture.store();
  store.save = () => Promise.reject(new Error(CANARY_PAGE_TEXT));
  const response = await handleRenderPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), {
    auth: fixture.world.authPort(),
    renders: store,
    gemini: () => Promise.resolve(reading(GOOD)),
    clock: { now: () => 0 },
    log: fixture.world.logger(),
  });
  assertEquals(response.status, 500);
  assertEquals(JSON.stringify(fixture.world.logs).includes(CANARY_PAGE_TEXT), false);
});

Deno.test("the logs hold no text of the page nor of the rendering [2]", async () => {
  const fixture = new Fixture();
  await fixture.ask();
  fixture.answers = [GOOD.replace("converge", "diverge")];
  fixture.pages.get(`${ALICE}:${PAGE_ID}`)!.rendering = null;
  await fixture.ask();
  const logged = JSON.stringify(fixture.world.logs);
  assertEquals(logged.includes(CANARY_PAGE_TEXT), false);
  assertEquals(logged.includes("bornée"), false);
});

Deno.test("a rendering made for a text that changed meanwhile is discarded and does not replace a newer one [4]", async () => {
  const fixture = new Fixture();
  let release: () => void = () => {};
  fixture.wait = new Promise((resolve) => {
    release = resolve;
  });
  const slow = fixture.ask();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const page = fixture.pages.get(`${ALICE}:${PAGE_ID}`)!;
  page.text = `${TEXT} corrigé`;
  page.rendering = { text: "# Plus récent", basedOn: await fingerprint(`${TEXT} corrigé`) };
  release();
  assertEquals(await readJson(await slow), { status: "discarded" });
  assertEquals(fixture.saved, []);
  assertEquals(page.rendering.text, "# Plus récent");
  assertEquals(fixture.world.logs.find((entry) => entry.event === "render_discarded")?.fields.code, "page_changed");
});
