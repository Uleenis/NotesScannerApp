import { assertEquals } from "jsr:@std/assert@1";
import { handleReadPage } from "../read-page/handler.ts";
import { GeminiFailure } from "../_shared/gemini.ts";
import type { GeminiFailureKind } from "../_shared/gemini.ts";
import { ALICE, DEFAULT_READING, PAGE_ID, post, readJson, START_OF_TEST, TOKEN_ALICE, World } from "./fakes.ts";

function call(world: World) {
  return handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), world.readDeps());
}

const FAILURE_KINDS: GeminiFailureKind[] = ["network", "timeout", "http_error", "bad_response", "no_candidate", "bad_finish", "empty_text"];

Deno.test("a first failure then a success makes two attempts and the page is read [23]", async () => {
  const world = new World();
  world.readyPage();
  world.push(world.failGemini(), DEFAULT_READING);
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.geminiImages.length, 2);
  assertEquals(world.page().status, "read");
  assertEquals(world.readings.length, 1);
  assertEquals(world.charges.length, 1);
});

for (const kind of FAILURE_KINDS) {
  Deno.test(`two failures of kind ${kind} make exactly two attempts, then the page waits in queued with read_error [23]`, async () => {
    const world = new World();
    world.readyPage();
    world.push(new GeminiFailure(kind), new GeminiFailure(kind), DEFAULT_READING);
    const response = await call(world);
    assertEquals(response.status, 200);
    assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
    assertEquals(world.geminiImages.length, 2);
    assertEquals(world.page().status, "queued");
    assertEquals(world.page().queueReason, "read_error");
    assertEquals(world.page().retryCount, 0);
    assertEquals(world.page().readAt, null);
    assertEquals(world.readings, []);
    assertEquals(world.pageTexts.size, 0);
    assertEquals(world.charges.length, 1);
  });
}

Deno.test("the photo is kept after a failed reading", async () => {
  const world = new World();
  world.readyPage();
  world.push(world.failGemini(), world.failGemini());
  const before = [...world.photos.keys()];
  await call(world);
  assertEquals([...world.photos.keys()], before);
  assertEquals(world.deletedPhotos, 0);
  assertEquals(world.pageImages.length, 1);
});

Deno.test("an unexpected error from Gemini's wrapper counts as a failure", async () => {
  const world = new World();
  world.readyPage();
  world.push(new TypeError("boom"), new TypeError("boom"));
  const response = await call(world);
  assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.geminiImages.length, 2);
});

Deno.test("a result that cannot be written queues the page with read_error without asking Gemini again", async () => {
  for (const step of ["insertReading", "upsertPageText", "markRead"]) {
    const world = new World();
    world.readyPage();
    world.failOn.add(step);
    const response = await call(world);
    assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
    assertEquals(world.geminiImages.length, 1);
    assertEquals(world.page().status, "queued");
    assertEquals(world.page().queueReason, "read_error");
    assertEquals(world.charges.length, 1);
  }
});

Deno.test("when the page cannot be released either, read-page answers 500 and logs only the error name", async () => {
  const world = new World();
  world.readyPage();
  world.failOn.add("insertReading");
  world.failOn.add("releaseToQueue");
  const response = await call(world);
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
  assertEquals(world.logs.at(-1), { event: "unexpected_error", fields: { errorName: "Error" } });
});

Deno.test("the reading is stored with its model, prompt version, thinking budget, tokens and duration", async () => {
  const world = new World();
  world.readyPage();
  world.geminiDurationMs = 5_900;
  world.push({ text: "Une page\nde test", modelVersion: "gemini-3.6-flash-001", inputTokens: 1_234, outputTokens: 200, thoughtsTokens: 16 });
  await call(world);
  assertEquals(world.readings, [{
    userId: ALICE,
    pageId: PAGE_ID,
    label: "B1",
    rawText: "Une page\nde test",
    model: "gemini-3.6-flash",
    modelVersion: "gemini-3.6-flash-001",
    promptVersion: "v0",
    thinkingBudget: 0,
    inputTokens: 1_234,
    outputTokens: 216,
    durationMs: 5_900,
  }]);
});

Deno.test("the duration is the one of the attempt that worked, not of the failed one", async () => {
  const world = new World();
  world.readyPage();
  world.geminiDurationMs = 700;
  world.push(world.failGemini(), DEFAULT_READING);
  await call(world);
  assertEquals(world.readings[0].durationMs, 700);
});

Deno.test("the model version falls back to the model name when the response has none", async () => {
  const world = new World();
  world.readyPage();
  world.push({ ...DEFAULT_READING, modelVersion: null });
  await call(world);
  assertEquals(world.readings[0].modelVersion, "gemini-3.6-flash");
});

Deno.test("the displayed text is the raw text, untouched, with the version of no-rules", async () => {
  const world = new World();
  world.readyPage();
  world.push({ ...DEFAULT_READING, text: "  indented\nline\n\n" });
  await call(world);
  assertEquals(world.readings[0].rawText, "  indented\nline\n\n");
  assertEquals(world.pageTexts.get(PAGE_ID), { userId: ALICE, text: "  indented\nline\n\n", pipelineVersion: "b1-raw" });
});

Deno.test("the page is marked read with its reading date, and queue_reason is cleared", async () => {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.geminiDurationMs = 1_000;
  await call(world);
  assertEquals(world.page().status, "read");
  assertEquals(world.page().queueReason, null);
  assertEquals(world.page().readAt, new Date(START_OF_TEST + 1_000).toISOString());
});

Deno.test("every write of the server is made in the name of the verified caller", async () => {
  const world = new World();
  world.readyPage();
  await call(world);
  assertEquals(world.readings.every((r) => r.userId === ALICE), true);
  assertEquals(world.pageImages.every((i) => i.userId === ALICE), true);
  assertEquals(world.pageTexts.get(PAGE_ID)?.userId, ALICE);
});

Deno.test("the response never carries the text of the page", async () => {
  const world = new World();
  world.readyPage();
  world.push({ ...DEFAULT_READING, text: "SECRET DIARY LINE" });
  const response = await call(world);
  assertEquals((await response.text()).includes("SECRET DIARY LINE"), false);
});
