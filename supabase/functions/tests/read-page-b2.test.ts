import { assert, assertEquals } from "jsr:@std/assert@1";
import { A_BUDGET_MS } from "../_shared/reading-a.ts";
import { MAX_ARBITRATED_TEXT } from "../_shared/reading-b2.ts";
import { ARBITRATE_TIMEOUT_MS } from "../_shared/reading-service.ts";
import { handleReadPage } from "../read-page/handler.ts";
import { handleRelaunchPage } from "../relaunch-page/handler.ts";
import {
  ALICE,
  CANARY_PAGE_TEXT,
  DEFAULT_READING,
  fakeAnswer,
  JPEG_BYTES,
  PAGE_ID,
  post,
  readJson,
  relaunch,
  RELAUNCH_SECRET,
  TOKEN_ALICE,
  World,
} from "./fakes.ts";

const B2 = { ...DEFAULT_READING, text: "First line\nSecond lines", inputTokens: 1090, outputTokens: 210 };
const MATH = { ...DEFAULT_READING, text: "Soit $x^2$ et \\frac{1}{2}" };
const GREEK = { ...DEFAULT_READING, text: "Καλημέρα κόσμε, τι κάνεις σήμερα;" };

function withService(): World {
  const world = new World();
  world.serviceConfigured = true;
  return world;
}

function call(world: World) {
  return handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), world.readDeps());
}

function stored(world: World, label: "B1" | "B2") {
  return world.readings.filter((reading) => reading.label === label);
}

function events(world: World) {
  return world.logs.map((record) => record.event);
}

Deno.test("B2 reads the same photo as B1, in a call of its own that carries nothing else [1]", async () => {
  const world = withService();
  world.readyPage();
  world.pushSecond(B2);
  await call(world);
  await world.settle();
  assertEquals(world.geminiImages, [JPEG_BYTES]);
  assertEquals(world.secondImages, [JPEG_BYTES]);
  assertEquals(world.recognitions[0].image, JPEG_BYTES);
});

Deno.test("B2 starts with B1, before B1 is written [1]", async () => {
  const world = new World();
  world.readyPage();
  await call(world);
  await world.settle();
  const calls = world.calls;
  assert(calls.indexOf("gemini_b2") > calls.indexOf("gemini"));
  assert(calls.indexOf("gemini_b2") < calls.indexOf("insertReading"));
});

Deno.test("the page is read as B1 arrives, whether B2 is still running [1]", async () => {
  const world = new World();
  world.readyPage();
  world.pushSecond("hold");
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
  assertEquals(stored(world, "B1").length, 1);
  assertEquals(stored(world, "B2"), []);
  world.releaseSecond(B2);
  await world.settle();
  assertEquals(stored(world, "B2").map((reading) => reading.rawText), [B2.text]);
});

Deno.test("the page is read as B1 arrives, whether B2 is already done or has failed [1]", async () => {
  for (const outcome of [B2, new World().failGemini("http_error")]) {
    const fresh = new World();
    fresh.readyPage();
    fresh.pushSecond(outcome, outcome);
    const response = await call(fresh);
    assertEquals(await readJson(response), { status: "read" });
    assertEquals(fresh.page().status, "read");
  }
});

Deno.test("B2 is written with label B2 and the settings of a Gemini call, without touching B1 or the shown text [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.pushSecond(B2);
  await call(fresh);
  await fresh.settle();
  const [b1] = stored(fresh, "B1");
  const [b2] = stored(fresh, "B2");
  assertEquals(b1.rawText, DEFAULT_READING.text);
  assertEquals({ ...b2, rawText: undefined, durationMs: undefined }, {
    ...b1,
    label: "B2",
    rawText: undefined,
    durationMs: undefined,
    inputTokens: 1090,
    outputTokens: 210,
  });
  assertEquals(b2.rawText, B2.text);
  assertEquals(fresh.pageTexts.get(PAGE_ID)?.text, DEFAULT_READING.text);
});

Deno.test("B2 is never counted: one charge for the page [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  await call(fresh);
  await fresh.settle();
  assertEquals(fresh.charges.length, 1);
  assertEquals(fresh.calls.filter((name) => name === "charge").length, 1);
});

Deno.test("a failure of B2 is tried once more, then the page stays without B2 [2]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.pushSecond(fresh.failGemini("timeout"), fresh.failGemini("http_error"));
  const response = await call(fresh);
  await fresh.settle();
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(fresh.calls.filter((name) => name === "gemini_b2").length, 2);
  assertEquals(stored(fresh, "B2"), []);
  assertEquals(fresh.page().status, "read");
  assertEquals(events(fresh).filter((event) => event === "gemini_attempt_failed").length, 2);
  assert(events(fresh).includes("b2_failed"));
});

Deno.test("a B2 that fails once and then reads is written [2]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.pushSecond(fresh.failGemini("network"), B2);
  await call(fresh);
  await fresh.settle();
  assertEquals(stored(fresh, "B2").map((reading) => reading.rawText), [B2.text]);
});

Deno.test("a page without B2 goes to /arbitrate with no b2 [2]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.pushSecond(fresh.failGemini(), fresh.failGemini());
  await call(fresh);
  await fresh.settle();
  assertEquals(fresh.arbitrations.length, 1);
  assertEquals(fresh.arbitrations[0].b2, null);
});

Deno.test("a B2 that cannot be written is not passed to /arbitrate [2]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.failOn.add("insertReadingB2");
  fresh.pushSecond(B2);
  const response = await call(fresh);
  await fresh.settle();
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(stored(fresh, "B2"), []);
  assertEquals(fresh.arbitrations[0].b2, null);
  assertEquals(fresh.page().status, "read");
});

Deno.test("/arbitrate receives B2 when it exists, B1 and A as before [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.geminiDurationMs = 0;
  fresh.pushSecond(B2);
  await call(fresh);
  await fresh.settle();
  assertEquals(fresh.arbitrations, [{
    pageId: PAGE_ID,
    userId: ALICE,
    b1: DEFAULT_READING.text,
    b2: B2.text,
    answer: fakeAnswer(PAGE_ID),
    durationMs: 0,
  }]);
});

Deno.test("a B2 above what /arbitrate accepts is written but not sent [2]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.pushSecond({ ...B2, text: "x".repeat(MAX_ARBITRATED_TEXT + 1) });
  await call(fresh);
  await fresh.settle();
  assertEquals(stored(fresh, "B2").length, 1);
  assertEquals(fresh.arbitrations.length, 1);
  assertEquals(fresh.arbitrations[0].b2, null);
});

Deno.test("/arbitrate waits for a B2 that comes after A and takes it [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.pushSecond("hold");
  await call(fresh);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assertEquals(fresh.arbitrations, []);
  fresh.releaseSecond(B2);
  await fresh.settle();
  assertEquals(fresh.arbitrations.length, 1);
  assertEquals(fresh.arbitrations[0].b2, B2.text);
});

Deno.test("/arbitrate waits for B2 at most until the end of the budget of A, keeping time for the arbitration [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.expireWaits = true;
  fresh.geminiDurationMs = 0;
  fresh.pushSecond("hold");
  await call(fresh);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assertEquals(fresh.waits, [A_BUDGET_MS - ARBITRATE_TIMEOUT_MS]);
  assertEquals(fresh.arbitrations.length, 1);
  assertEquals(fresh.arbitrations[0].b2, null);
  assert(events(fresh).includes("b2_late"));
  assertEquals(fresh.heldSecond.length, 1);
  fresh.releaseSecond(B2);
  await fresh.settle();
});

Deno.test("a late B2 is still written once A has gone on without it [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.expireWaits = true;
  fresh.pushSecond("hold");
  await call(fresh);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  fresh.releaseSecond(B2);
  await fresh.settle();
  assertEquals(stored(fresh, "B2").map((reading) => reading.rawText), [B2.text]);
});

Deno.test("when B1 fails, B2 is not written, even if it arrives afterwards [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.push(fresh.failGemini(), fresh.failGemini());
  fresh.pushSecond("hold");
  const response = await call(fresh);
  assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
  fresh.releaseSecond(B2);
  await fresh.settle();
  assertEquals(stored(fresh, "B1"), []);
  assertEquals(stored(fresh, "B2"), []);
  assertEquals(fresh.page().status, "queued");
});

Deno.test("when B1 fails, B2 does not try again after its first failure [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.push(fresh.failGemini(), fresh.failGemini());
  fresh.pushSecond("hold");
  await call(fresh);
  fresh.releaseSecond(fresh.failGemini());
  await fresh.settle();
  assertEquals(fresh.calls.filter((name) => name === "gemini_b2").length, 1);
});

Deno.test("a B1 that cannot be written leaves B2 unwritten [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.failOn.add("insertReading");
  await call(fresh);
  await fresh.settle();
  assertEquals(stored(fresh, "B2"), []);
  assertEquals(fresh.page().status, "queued");
});

Deno.test("a page of math keeps its B2 and sends nothing to /arbitrate [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.push(MATH);
  fresh.pushSecond({ ...MATH, text: "Soit $x^2$ et $\\frac{1}{2}$" });
  await call(fresh);
  await fresh.settle();
  assertEquals(fresh.page().pageType, "math");
  assertEquals(stored(fresh, "B2").length, 1);
  assertEquals(fresh.arbitrations, []);
});

Deno.test("a page in a script that is not Latin gets no B2 written [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.push(GREEK);
  fresh.pushSecond("hold");
  await call(fresh);
  await fresh.settle();
  assertEquals(fresh.page().pageType, "unsupported_script");
  assertEquals(stored(fresh, "B2"), []);
  assertEquals(fresh.arbitrations, []);
});

Deno.test("without a reading service, B2 is still read and written [1]", async () => {
  const fresh = new World();
  fresh.readyPage();
  fresh.pushSecond(B2);
  await call(fresh);
  await fresh.settle();
  assertEquals(stored(fresh, "B2").length, 1);
  assertEquals(fresh.arbitrations, []);
});

Deno.test("the relaunch task reads B2 as read-page does [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.page().queueReason = "read_error";
  fresh.charges.push({ userId: ALICE, pageId: PAGE_ID });
  fresh.pushSecond(B2);
  await handleRelaunchPage(relaunch(RELAUNCH_SECRET, { page_id: PAGE_ID }), fresh.relaunchDeps());
  await fresh.settle();
  assertEquals(stored(fresh, "B2").map((reading) => reading.rawText), [B2.text]);
  assertEquals(fresh.arbitrations[0].b2, B2.text);
  assertEquals(fresh.charges.length, 1);
});

Deno.test("logs name the pass and carry no page text [1]", async () => {
  const fresh = withService();
  fresh.readyPage();
  fresh.push({ ...DEFAULT_READING, text: CANARY_PAGE_TEXT });
  fresh.pushSecond(fresh.failGemini(), { ...B2, text: CANARY_PAGE_TEXT });
  await call(fresh);
  await fresh.settle();
  assert(!JSON.stringify(fresh.logs).includes(CANARY_PAGE_TEXT));
  const failedAttempt = fresh.logs.find((record) => record.event === "gemini_attempt_failed");
  assertEquals(failedAttempt?.fields.code, "B2");
});
