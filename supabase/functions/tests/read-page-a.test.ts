import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLogger } from "../_shared/log.ts";
import { A_BUDGET_MS } from "../_shared/reading-a.ts";
import { handleReadPage } from "../read-page/handler.ts";
import { handleRelaunchPage } from "../relaunch-page/handler.ts";
import {
  ALICE,
  CANARY_EXCEPTION,
  CANARY_PAGE_TEXT,
  capture,
  DEFAULT_READING,
  fakeAnswer,
  JPEG_BYTES,
  PAGE_ID,
  post,
  readJson,
  relaunch,
  TOKEN_ALICE,
  World,
} from "./fakes.ts";

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

function events(world: World) {
  return world.logs.map((record) => record.event);
}

Deno.test("the photo goes to the service and to Gemini at the same time", async () => {
  const world = withService();
  world.readyPage();
  await call(world);
  await world.settle();
  const order = world.calls.filter((name) => ["claim", "recognize", "gemini", "markRead", "arbitrate"].includes(name));
  assertEquals(order, ["claim", "recognize", "gemini", "markRead", "arbitrate"]);
});

Deno.test("/recognize gets the stored photo and the page id, never B1 [12]", async () => {
  const world = withService();
  world.readyPage();
  await call(world);
  await world.settle();
  assertEquals(world.recognitions.length, 1);
  assertEquals(world.recognitions[0].pageId, PAGE_ID);
  assertEquals(world.recognitions[0].image, JPEG_BYTES);
  assertEquals(world.geminiImages, [JPEG_BYTES]);
});

Deno.test("a page of text sends A and B1 to /arbitrate once B1 is written", async () => {
  const world = withService();
  world.readyPage();
  world.geminiDurationMs = 0;
  world.recognizeOutcomes.push("hold");
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  world.release();
  await world.settle();
  assertEquals(world.page().pageType, "text");
  assertEquals(world.arbitrations, [{ pageId: PAGE_ID, userId: ALICE, b1: DEFAULT_READING.text, answer: fakeAnswer(PAGE_ID), durationMs: world.recognizeDurationMs }]);
  assertEquals(world.pageTexts.get(PAGE_ID)?.text, DEFAULT_READING.text);
});

Deno.test("a page whose B1 holds LaTeX is math: no call to /arbitrate, the reading of A cancelled [5]", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold");
  world.push(MATH);
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  await world.settle();
  assertEquals(world.page().pageType, "math");
  assertEquals(world.page().status, "read");
  assertEquals(world.recognitions[0].signal.aborted, true);
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.at(-1), { event: "a_cancelled", fields: { pageId: PAGE_ID, code: "math" } });
});

Deno.test("a page of math whose A already arrived throws A away [5]", async () => {
  const world = withService();
  world.readyPage();
  world.push(MATH);
  await call(world);
  await world.settle();
  assertEquals(world.page().pageType, "math");
  assertEquals(world.arbitrations, []);
});

Deno.test("a page in a script that is not Latin is unsupported_script: no call to /arbitrate [6]", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold");
  world.push(GREEK);
  await call(world);
  await world.settle();
  assertEquals(world.page().pageType, "unsupported_script");
  assertEquals(world.page().status, "read");
  assertEquals(world.recognitions[0].signal.aborted, true);
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.at(-1), { event: "a_cancelled", fields: { pageId: PAGE_ID, code: "unsupported_script" } });
});

Deno.test("the page is read when B1 is written, while A is still running [10]", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold");
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
  assertEquals(world.pageTexts.get(PAGE_ID)?.text, DEFAULT_READING.text);
  assertEquals(world.arbitrations, []);
  world.release();
  await world.settle();
  assertEquals(world.arbitrations.length, 1);
  assertEquals(world.page().status, "read");
});

Deno.test("the page stays read when A fails for good after B1 [10, 11]", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold", { ok: false, failure: { kind: "http_error", status: 500, code: "reading_failed" } });
  await call(world);
  assertEquals(world.page().status, "read");
  world.release({ ok: false, failure: { kind: "http_error", status: 503, code: "busy" } });
  await world.settle();
  assertEquals(world.recognitions.length, 2);
  assertEquals(world.arbitrations, []);
  assertEquals(world.page().status, "read");
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "recognize_failed" } });
});

Deno.test("a failed recognition is tried once more, and the second try is used [11]", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push({ ok: false, failure: { kind: "network" } });
  await call(world);
  await world.settle();
  assertEquals(world.recognitions.length, 2);
  assertEquals(world.arbitrations.length, 1);
  assert(events(world).includes("a_done"));
});

Deno.test("a recognition that timed out is not tried again: the service gave up at its own limit", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push({ ok: false, failure: { kind: "timeout" } });
  await call(world);
  await world.settle();
  assertEquals(world.recognitions.length, 1);
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "recognize_failed" } });
});

Deno.test("A keeps within its budget from the send: each call gets the time left", async () => {
  const world = withService();
  world.readyPage();
  world.geminiDurationMs = 0;
  world.recognizeOutcomes.push("hold");
  await call(world);
  world.release();
  await world.settle();
  assertEquals(world.recognitions[0].timeoutMs, A_BUDGET_MS);
  assertEquals(world.arbitrateTimeouts, [A_BUDGET_MS - world.recognizeDurationMs]);
});

Deno.test("no second recognition starts once the budget of A is spent", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeDurationMs = A_BUDGET_MS;
  world.recognizeOutcomes.push("hold");
  await call(world);
  world.release({ ok: false, failure: { kind: "http_error", status: 503, code: "busy" } });
  await world.settle();
  assertEquals(world.recognitions.length, 1);
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "recognize_failed" } });
});

Deno.test("no arbitration starts once the budget of A is spent", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeDurationMs = A_BUDGET_MS;
  world.recognizeOutcomes.push("hold");
  await call(world);
  world.release();
  await world.settle();
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "out_of_time" } });
});

Deno.test("already_read on the second arbitration means the first one wrote A", async () => {
  const world = withService();
  world.readyPage();
  world.arbitrateOutcomes.push({ ok: false, failure: { kind: "network" } }, { ok: false, failure: { kind: "http_error", status: 409, code: "already_read" } });
  await call(world);
  await world.settle();
  assertEquals(world.arbitrations.length, 2);
  assertEquals(world.logs.at(-1)?.event, "a_done");
  assertEquals(world.logs.at(-1)?.fields.code, "already_read");
});

Deno.test("a refusal of /recognize is not tried again [11]", async () => {
  for (const status of [400, 413, 415, 422]) {
    const world = withService();
    world.readyPage();
    world.recognizeOutcomes.push({ ok: false, failure: { kind: "http_error", status } });
    await call(world);
    await world.settle();
    assertEquals(world.recognitions.length, 1, String(status));
    assertEquals(world.arbitrations, []);
    assertEquals(world.page().status, "read");
  }
});

Deno.test("a failed arbitration is tried once more, a refusal is not [11]", async () => {
  const retried = withService();
  retried.readyPage();
  retried.arbitrateOutcomes.push({ ok: false, failure: { kind: "http_error", status: 503, code: "busy" } });
  await call(retried);
  await retried.settle();
  assertEquals(retried.arbitrations.length, 2);
  assert(events(retried).includes("a_done"));

  const twice = withService();
  twice.readyPage();
  twice.arbitrateOutcomes.push({ ok: false, failure: { kind: "http_error", status: 500, code: "arbitration_failed" } }, { ok: false, failure: { kind: "network" } });
  await call(twice);
  await twice.settle();
  assertEquals(twice.arbitrations.length, 2);
  assertEquals(twice.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "arbitrate_failed" } });

  const late = withService();
  late.readyPage();
  late.arbitrateOutcomes.push({ ok: false, failure: { kind: "timeout" } });
  await call(late);
  await late.settle();
  assertEquals(late.arbitrations.length, 1);
  assertEquals(late.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "arbitrate_timeout" } });

  for (const code of ["page_not_found", "not_text", "already_read"]) {
    const refused = withService();
    refused.readyPage();
    refused.arbitrateOutcomes.push({ ok: false, failure: { kind: "http_error", status: 409, code } });
    await call(refused);
    await refused.settle();
    assertEquals(refused.arbitrations.length, 1, code);
    assertEquals(refused.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code } });
    assertEquals(refused.page().status, "read");
  }
});

Deno.test("when B1 fails, A is abandoned and the page is queued as before", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold");
  world.push(world.failGemini(), world.failGemini());
  const response = await call(world);
  assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
  await world.settle();
  assertEquals(world.recognitions[0].signal.aborted, true);
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.some((record) => record.event === "a_cancelled" && record.fields.code === "b1_failed"), true);
});

Deno.test("when B1 cannot be written, A is abandoned too", async () => {
  const world = withService();
  world.readyPage();
  world.failOn.add("upsertPageText");
  await call(world);
  await world.settle();
  assertEquals(world.arbitrations, []);
  assertEquals(world.logs.some((record) => record.event === "a_cancelled" && record.fields.code === "b1_failed"), true);
});

Deno.test("without a configured service the page is read by B1 alone, as in slice 1", async () => {
  const world = withService();
  world.readyPage();
  world.serviceConfigured = false;
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.backgroundTasks, []);
  assertEquals(world.recognitions, []);
  assertEquals(world.page().pageType, "text");
  assertEquals(events(world).some((event) => event.startsWith("a_")), false);
});

Deno.test("the type of the page is written without a service too", async () => {
  const world = withService();
  world.readyPage();
  world.serviceConfigured = false;
  world.push(MATH);
  await call(world);
  assertEquals(world.page().pageType, "math");
});

Deno.test("the relaunch task reads A beside B1 the same way", async () => {
  const world = withService();
  world.readyPage();
  world.page().queueReason = "read_error";
  const response = await handleRelaunchPage(relaunch(world.relaunchDeps().secret, { page_id: PAGE_ID }), world.relaunchDeps());
  assertEquals(await readJson(response), { status: "read" });
  await world.settle();
  assertEquals(world.recognitions.length, 1);
  assertEquals(world.arbitrations.length, 1);
});

Deno.test("A never charges the page a second time", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push({ ok: false, failure: { kind: "network" } });
  world.arbitrateOutcomes.push({ ok: false, failure: { kind: "http_error", status: 500 } });
  await call(world);
  await world.settle();
  assertEquals(world.charges.length, 1);
  assertEquals(world.chargeArguments.length, 1);
});

Deno.test("the time from the send to the service to page_tokens is logged with the count of positions", async () => {
  const world = withService();
  world.readyPage();
  world.recognizeOutcomes.push("hold");
  await call(world);
  world.release();
  await world.settle();
  assertEquals(world.logs.at(-1), {
    event: "a_done",
    fields: { pageId: PAGE_ID, durationMs: world.geminiDurationMs + world.recognizeDurationMs + world.arbitrateDurationMs, tokens: 3 },
  });
  assertEquals(world.logs.some((record) => record.event === "a_sent" && record.fields.pageId === PAGE_ID), true);
});

Deno.test("an unexpected error in the background is logged by its name and never escapes", async () => {
  const world = withService();
  world.readyPage();
  const deps = world.readDeps();
  const service = deps.service;
  if (!service) throw new Error("the fake has a service");
  deps.service = { ...service, arbitrate: () => Promise.reject(new Error(CANARY_EXCEPTION)) };
  const response = await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), deps);
  assertEquals(await readJson(response), { status: "read" });
  await world.settle();
  assertEquals(world.logs.at(-1), { event: "unexpected_error", fields: { errorName: "Error" } });
});

Deno.test("the logs of A hold neither the text of the page nor the image nor the answer [15]", async () => {
  const scenarios: ((world: World) => void)[] = [
    () => {},
    (world) => world.recognizeOutcomes.push({ ok: false, failure: { kind: "network" } }, { ok: false, failure: { kind: "timeout" } }),
    (world) => world.arbitrateOutcomes.push({ ok: false, failure: { kind: "http_error", status: 409, code: "already_read" } }),
    (world) => world.push({ ...DEFAULT_READING, text: `$${CANARY_PAGE_TEXT}$` }),
    (world) => world.push({ ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT} Καλημέρα κόσμε τι κάνεις σήμερα φίλε μου` }),
  ];
  for (const build of scenarios) {
    const world = withService();
    world.readyPage();
    build(world);
    if (world.geminiOutcomes.length === 0) world.push({ ...DEFAULT_READING, text: `${CANARY_PAGE_TEXT}\nSecond line` });
    const sink: string[] = [];
    world.loggerOverride = createLogger((line) => sink.push(line));
    const spy = capture();
    try {
      await call(world);
      await world.settle();
    } finally {
      spy.restore();
    }
    assertEquals(spy.lines, []);
    const logged = sink.join("\n");
    for (const forbidden of [CANARY_PAGE_TEXT, "Second line", "First", "alto", btoa(String.fromCharCode(...JPEG_BYTES))]) {
      assert(!logged.includes(forbidden), `the logs contain ${forbidden}`);
    }
  }
});
