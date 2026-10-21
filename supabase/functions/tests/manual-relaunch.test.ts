import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleReadPage } from "../read-page/handler.ts";
import { createLogger } from "../_shared/log.ts";
import {
  ALICE,
  BOB,
  CANARY_GEMINI_ERROR,
  CANARY_PAGE_TEXT,
  capture,
  DAY_MS,
  OPEN_ALLOWANCE,
  PAGE_ID,
  post,
  readJson,
  START_OF_TEST,
  TOKEN_ALICE,
  TOKEN_BOB,
  World,
} from "./fakes.ts";

function failedWorld(): World {
  const world = new World();
  world.readyPage();
  world.page().status = "failed";
  world.page().retryCount = 3;
  world.charges.push({ userId: ALICE, pageId: PAGE_ID });
  return world;
}

function call(world: World, token: string = TOKEN_ALICE) {
  return handleReadPage(post(token, { page_id: PAGE_ID }), world.readDeps());
}

Deno.test("the owner of a failed page can relaunch it, and a good reading puts it in read", async () => {
  const world = failedWorld();
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
  assertEquals(world.readings.filter((reading) => reading.label === "B1").length, 1);
});

Deno.test("a relaunch of a failed page is one reading, and its failure puts the page back in failed with retry_count 3", async () => {
  const world = failedWorld();
  world.push(world.failGemini(), world.failGemini());
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "failed" });
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().retryCount, 3);
  assertEquals(world.page().queueReason, null);
  assertEquals(world.geminiImages.length, 2);
  assertEquals(world.photos.size, 1);
});

Deno.test("a relaunch of a failed page claims it as a failed page, with the cut-off of a day", async () => {
  const world = failedWorld();
  await call(world);
  const relaunchedBefore = new Date(START_OF_TEST - DAY_MS).toISOString();
  assertEquals(world.claimArguments, [[ALICE, PAGE_ID, { status: "failed", retryCount: 3, relaunchedBefore }]]);
});

Deno.test("a failed page is never charged again by a relaunch, even at the limit [20]", async () => {
  const world = failedWorld();
  world.allowances.set(ALICE, { ...OPEN_ALLOWANCE, used: 15, remaining: 0, blockedReason: "monthly_limit" });
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(world.charges.length, 1);
  assertEquals(world.chargeArguments, [[PAGE_ID]]);
});

Deno.test("a second relaunch within a day is refused with relaunch_too_soon, without Gemini and without a charge call", async () => {
  const world = failedWorld();
  world.push(world.failGemini(), world.failGemini());
  await call(world);
  const calls = world.geminiImages.length;
  const claims = world.claimArguments.length;
  for (const wait of [0, 60_000, DAY_MS - 120_000]) {
    world.clock += wait;
    const response = await call(world);
    assertEquals(response.status, 429);
    assertEquals(await readJson(response), { error: "relaunch_too_soon" });
  }
  assertEquals(world.geminiImages.length, calls);
  assertEquals(world.claimArguments.length, claims);
  assertEquals(world.page().status, "failed");
});

Deno.test("a failed page can be relaunched again after a day", async () => {
  const world = failedWorld();
  world.push(world.failGemini(), world.failGemini());
  await call(world);
  world.clock += DAY_MS + 1;
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.geminiImages.length, 3);
});

Deno.test("the first relaunch is never held back by the automatic attempts that came before", async () => {
  const world = new World();
  world.readyPage();
  for (let i = 0; i < 4; i++) {
    world.push(world.failGemini(), world.failGemini());
    await call(world);
  }
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().manualRelaunchedAt, null);
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
});

Deno.test("calls repeated on a page that always fails reach Gemini ten times at most in a day and charge once", async () => {
  const world = new World();
  world.readyPage();
  for (let i = 0; i < 30; i++) {
    world.push(world.failGemini(), world.failGemini());
    await call(world);
  }
  assertEquals(world.geminiImages.length, 10);
  assertEquals(world.charges.length, 1);
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().retryCount, 3);
});

Deno.test("a failed page of another user is not found and nothing is touched", async () => {
  const world = failedWorld();
  const response = await call(world, TOKEN_BOB);
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "page_not_found" });
  assertEquals(world.geminiImages, []);
  assertEquals(world.claimArguments, []);
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().manualRelaunchedAt, null);
});

Deno.test("a failed page of another user is still refused when the row rules let it through", async () => {
  const world = new World();
  world.readyPage(BOB);
  world.page().status = "failed";
  world.page().retryCount = 3;
  world.brokenRowLevelSecurity = true;
  const response = await call(world);
  assertEquals(response.status, 404);
  assertEquals(world.claimArguments, []);
  assertEquals(world.calls.includes("charge"), false);
});

Deno.test("a failed page whose last relaunch changed since it was read is not claimed", async () => {
  const world = failedWorld();
  const deps = world.readDeps();
  const claim = deps.server.claimForReading;
  deps.server.claimForReading = (userId, pageId, expected) => {
    world.page().manualRelaunchedAt = new Date(world.clock).toISOString();
    return claim(userId, pageId, expected);
  };
  const response = await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), deps);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(world.geminiImages, []);
});

Deno.test("two relaunches of a failed page that arrive together read it once", async () => {
  const world = failedWorld();
  const [a, b] = await Promise.all([call(world), call(world)]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  assertEquals(world.geminiImages.length, 1);
  assertEquals(world.readings.filter((reading) => reading.label === "B1").length, 1);
});

Deno.test("a failed page with a photo that is gone is refused as before and stays failed", async () => {
  const world = failedWorld();
  world.photos.clear();
  const response = await call(world);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_missing" });
  assertEquals(world.page().status, "failed");
  assertEquals(world.geminiImages, []);
});

Deno.test("read-page still refuses a page that is read or processing", async () => {
  for (const [status, code] of [["read", "page_already_read"], ["processing", "page_processing"]] as const) {
    const world = failedWorld();
    world.page().status = status;
    const response = await call(world);
    assertEquals(response.status, 409);
    assertEquals(await readJson(response), { error: code });
    assertEquals(world.geminiImages, []);
  }
});

Deno.test("a manual relaunch is logged without any content [16]", async () => {
  const world = failedWorld();
  const sink: string[] = [];
  world.loggerOverride = createLogger((line) => sink.push(line));
  world.push({ text: CANARY_PAGE_TEXT, modelVersion: null, inputTokens: 5, outputTokens: 6, thoughtsTokens: 0 });
  const spy = capture();
  try {
    await call(world);
  } finally {
    spy.restore();
  }
  assertEquals(spy.lines, []);
  const logged = sink.join("\n");
  assert(logged.includes("manual_relaunch"));
  assert(!logged.includes(CANARY_PAGE_TEXT));
  assert(!logged.includes(CANARY_GEMINI_ERROR));
});
