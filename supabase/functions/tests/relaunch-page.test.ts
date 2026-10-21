import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleReadPage } from "../read-page/handler.ts";
import { handleRelaunchPage } from "../relaunch-page/handler.ts";
import { createLogger } from "../_shared/log.ts";
import {
  ALICE,
  BOB,
  CANARY_GEMINI_ERROR,
  CANARY_PAGE_TEXT,
  capture,
  JPEG_BYTES,
  MAX_BYTES,
  PAGE_ID,
  PNG_BYTES,
  post,
  readJson,
  relaunch,
  RELAUNCH_SECRET,
  TOKEN_ALICE,
  World,
} from "./fakes.ts";

const WRONG_SECRET = "wrong-".repeat(6);

function dueWorld(retryCount = 0): World {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.page().retryCount = retryCount;
  world.charges.push({ userId: ALICE, pageId: PAGE_ID });
  return world;
}

function call(world: World, secret: string | null = RELAUNCH_SECRET, body: unknown = { page_id: PAGE_ID }) {
  return handleRelaunchPage(relaunch(secret, body), world.relaunchDeps());
}

function assertUntouched(world: World) {
  assertEquals(world.geminiImages, []);
  assertEquals(world.readings, []);
  assertEquals(world.calls.includes("claim"), false);
  assertEquals(world.calls.includes("charge"), false);
  assertEquals(world.charges.length <= 1, true);
}

Deno.test("relaunch-page reads a page that is queued for read_error and answers read", async () => {
  const world = dueWorld();
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
  assertEquals(world.readings.filter((reading) => reading.label === "B1").length, 1);
});

Deno.test("relaunch-page refuses a request without the secret and touches nothing", async () => {
  const world = dueWorld();
  const response = await call(world, null);
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertEquals(world.calls, []);
  assertUntouched(world);
});

Deno.test("relaunch-page refuses a wrong secret, a prefix of the secret and an extended secret", async () => {
  for (const secret of ["wrong", RELAUNCH_SECRET.slice(0, -1), `${RELAUNCH_SECRET}x`, "", RELAUNCH_SECRET.toUpperCase()]) {
    const world = dueWorld();
    const response = await call(world, secret);
    assertEquals(response.status, 401);
    assertEquals(world.calls, []);
  }
});

Deno.test("relaunch-page refuses an account token sent in place of the secret", async () => {
  const world = dueWorld();
  const request = new Request("http://functions.test/fn", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN_ALICE}`, "content-type": "application/json" },
    body: JSON.stringify({ page_id: PAGE_ID }),
  });
  const response = await handleRelaunchPage(request, world.relaunchDeps());
  assertEquals(response.status, 401);
  assertEquals(world.calls, []);
});

Deno.test("relaunch-page never opens when no secret is configured, even for an empty header", async () => {
  const world = dueWorld();
  for (const header of ["", "anything", null]) {
    const response = await handleRelaunchPage(relaunch(header, { page_id: PAGE_ID }), world.relaunchDeps(""));
    assertEquals(response.status, 401);
  }
  assertEquals(world.calls, []);
});

Deno.test("read-page does not accept the relaunch secret as a token", async () => {
  const world = dueWorld();
  const response = await handleReadPage(post(RELAUNCH_SECRET, { page_id: PAGE_ID }), world.readDeps());
  assertEquals(response.status, 401);
  assertEquals(world.calls, []);
});

Deno.test("relaunch-page refuses anything but a POST", async () => {
  const world = dueWorld();
  const response = await handleRelaunchPage(relaunch(RELAUNCH_SECRET, "", "GET"), world.relaunchDeps());
  assertEquals(response.status, 405);
  assertEquals(world.calls, []);
});

Deno.test("relaunch-page refuses a body that is not a page id", async () => {
  const world = dueWorld();
  for (const body of ["not json", {}, { page_id: 12 }, { page_id: "not-a-uuid" }, [PAGE_ID]]) {
    const response = await call(world, RELAUNCH_SECRET, body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
  }
  assertEquals(world.calls, []);
});

Deno.test("relaunch-page treats an unknown page as not found", async () => {
  const world = new World();
  const response = await call(world);
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "page_not_found" });
  assertUntouched(world);
});

Deno.test("relaunch-page only takes a page that is queued for read_error", async () => {
  const states: [string, (world: World) => void][] = [
    ["queued without a cause", (world) => {
      world.page().queueReason = null;
    }],
    ["queued offline", (world) => {
      world.page().queueReason = "offline";
    }],
    ["processing", (world) => {
      world.page().status = "processing";
      world.page().queueReason = null;
    }],
    ["read", (world) => {
      world.page().status = "read";
      world.page().queueReason = null;
    }],
    ["failed", (world) => {
      world.page().status = "failed";
      world.page().queueReason = null;
      world.page().retryCount = 3;
    }],
  ];
  for (const [name, change] of states) {
    const world = dueWorld();
    change(world);
    const before = JSON.stringify(world.page());
    const response = await call(world);
    assertEquals(response.status, 409, name);
    assertEquals(await readJson(response), { error: "page_not_relaunchable" }, name);
    assertEquals(JSON.stringify(world.page()), before, name);
    assertEquals(world.geminiImages, [], name);
    assertEquals(world.calls.includes("charge"), false, name);
  }
});

Deno.test("relaunch-page writes in the name of the owner found on the page, whatever the request says", async () => {
  const world = dueWorld();
  const response = await call(world, RELAUNCH_SECRET, { page_id: PAGE_ID, user_id: BOB, userId: BOB });
  assertEquals(response.status, 200);
  assertEquals(world.readings.map((r) => r.userId), [ALICE, ALICE]);
  assertEquals(world.pageTexts.get(PAGE_ID)?.userId, ALICE);
  assertEquals(world.pageImages.map((i) => i.userId), [ALICE]);
  assertEquals(world.claimArguments[0][0], ALICE);
});

Deno.test("relaunch-page looks for the photo under the owner's folder, not under a folder from the request", async () => {
  const world = dueWorld();
  world.photos.clear();
  world.addPhoto(BOB, PAGE_ID);
  const response = await call(world, RELAUNCH_SECRET, { page_id: PAGE_ID, user_id: BOB });
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_missing" });
  assertEquals(world.geminiImages, []);
});

Deno.test("a relaunch charges nothing a second time: the page is charged once and never refused for a limit [20]", async () => {
  const world = dueWorld(2);
  world.allowances.set(ALICE, {
    isAnonymous: true,
    used: 3,
    max: 3,
    remaining: 0,
    resetsAt: null,
    blockedReason: "anonymous_limit",
  });
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.charges.length, 1);
  assertEquals(world.chargeArguments, [[PAGE_ID]]);
});

Deno.test("a relaunch that fails is counted by read-page's own rule, never twice", async () => {
  const world = dueWorld(0);
  world.push(world.failGemini(), world.failGemini());
  const first = await call(world);
  assertEquals(await readJson(first), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.page().retryCount, 1);
  world.push(world.failGemini(), world.failGemini());
  const second = await call(world);
  assertEquals(await readJson(second), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.page().retryCount, 2);
});

Deno.test("three failed relaunches put the page in failed, with eight Gemini calls at most and one charge [24]", async () => {
  const world = new World();
  world.readyPage();
  world.push(world.failGemini(), world.failGemini());
  await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), world.readDeps());
  assertEquals(world.page().retryCount, 0);
  for (let i = 0; i < 6; i++) {
    world.push(world.failGemini(), world.failGemini());
    await call(world);
  }
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().queueReason, null);
  assertEquals(world.page().retryCount, 3);
  assertEquals(world.geminiImages.length, 8);
  assertEquals(world.charges.length, 1);
  assertEquals(world.deletedPhotos, 0);
  assertEquals(world.photos.size, 1);
});

Deno.test("a relaunch at the limit of relaunches fails the page with retry_count 3, never 4", async () => {
  const world = dueWorld(2);
  world.push(world.failGemini(), world.failGemini());
  const response = await call(world);
  assertEquals(await readJson(response), { status: "failed" });
  assertEquals(world.page().retryCount, 3);
});

Deno.test("a relaunch whose result cannot be written counts like a failed reading", async () => {
  const world = dueWorld(1);
  world.failOn.add("insertReading");
  const response = await call(world);
  assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.page().retryCount, 2);
  assertEquals(world.geminiImages.length, 1);
});

Deno.test("a photo that cannot be read fails the page for good, without Gemini and without deleting the photo", async () => {
  const cases: [string, (world: World) => void, number, string][] = [
    ["missing", (world) => world.photos.clear(), 422, "photo_missing"],
    ["not a jpeg by its type", (world) => {
      world.photos.clear();
      world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/png");
    }, 422, "photo_not_jpeg"],
    ["not a jpeg by its bytes", (world) => {
      world.photos.clear();
      world.addPhoto(ALICE, PAGE_ID, PNG_BYTES, "image/jpeg");
    }, 422, "photo_not_jpeg"],
    ["too large", (world) => {
      world.photos.clear();
      world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/jpeg", MAX_BYTES + 1);
    }, 422, "photo_too_large"],
  ];
  for (const [name, change, status, code] of cases) {
    const world = dueWorld();
    change(world);
    const photos = world.photos.size;
    const response = await call(world);
    assertEquals(response.status, status, name);
    assertEquals(await readJson(response), { error: code }, name);
    assertEquals(world.page().status, "failed", name);
    assertEquals(world.page().queueReason, null, name);
    assertEquals(world.abandoned, [PAGE_ID], name);
    assertEquals(world.geminiImages, [], name);
    assertEquals(world.photos.size, photos, name);
    assertEquals(world.deletedPhotos, 0, name);
    assertEquals(world.charges.length, 1, name);
  }
});

Deno.test("two relaunches that arrive together read the page once", async () => {
  const world = dueWorld(1);
  const [a, b] = await Promise.all([call(world), call(world)]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  assertEquals(world.geminiImages.length, 1);
  assertEquals(world.readings.filter((reading) => reading.label === "B1").length, 1);
  assertEquals(world.charges.length, 1);
  assertEquals(world.page().status, "read");
});

Deno.test("a page whose counters changed since they were read is not relaunched", async () => {
  const world = dueWorld(0);
  const deps = world.relaunchDeps();
  const claim = deps.server.claimForReading;
  deps.server.claimForReading = (userId, pageId, expected) => {
    world.page().retryCount = 1;
    return claim(userId, pageId, expected);
  };
  const response = await handleRelaunchPage(relaunch(RELAUNCH_SECRET, { page_id: PAGE_ID }), deps);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(world.geminiImages, []);
});

Deno.test("relaunch-page asks for the charge with the page id alone and claims as a queued page", async () => {
  const world = dueWorld(1);
  await call(world);
  assertEquals(world.claimArguments, [[ALICE, PAGE_ID, { status: "queued", queueReason: "read_error", retryCount: 1 }]]);
});

Deno.test("relaunch-page answers with codes only, never with the page", async () => {
  const world = dueWorld();
  world.push({ text: CANARY_PAGE_TEXT, modelVersion: null, inputTokens: 5, outputTokens: 6, thoughtsTokens: 0 });
  const response = await call(world);
  const text = JSON.stringify(await readJson(response));
  assertEquals(text, JSON.stringify({ status: "read" }));
  assert(!text.includes(CANARY_PAGE_TEXT));
});

Deno.test("the logs of relaunch-page hold neither the secret, nor the text, nor Gemini's error, nor the image [16]", async () => {
  const image = btoa(String.fromCharCode(...JPEG_BYTES));
  for (const build of [
    (world: World) => world.push({ text: CANARY_PAGE_TEXT, modelVersion: null, inputTokens: 5, outputTokens: 6, thoughtsTokens: 0 }),
    (world: World) => world.push(new TypeError(CANARY_GEMINI_ERROR), new TypeError(CANARY_GEMINI_ERROR)),
    (world: World) => world.photos.clear(),
    (world: World) => {
      world.failOn.add("getPage");
    },
  ]) {
    const world = dueWorld();
    build(world);
    const sink: string[] = [];
    world.loggerOverride = createLogger((line) => sink.push(line));
    const spy = capture();
    try {
      await call(world);
      await call(world, WRONG_SECRET);
    } finally {
      spy.restore();
    }
    assertEquals(spy.lines, []);
    const logged = sink.join("\n");
    for (const word of [RELAUNCH_SECRET, WRONG_SECRET, CANARY_PAGE_TEXT, CANARY_GEMINI_ERROR, image, "Second line"]) {
      assert(!logged.includes(word), `the logs contain ${word}`);
    }
    assert(logged.length > 0);
  }
});

Deno.test("relaunch-page logs a page it gives up on, with no content", async () => {
  const world = dueWorld();
  world.photos.clear();
  await call(world);
  assertEquals(world.logs.some((l) => l.event === "page_abandoned" && l.fields.pageId === PAGE_ID), true);
});

Deno.test("relaunch-page answers 500 and touches nothing when the page cannot be read", async () => {
  const world = dueWorld();
  world.failOn.add("getPage");
  const response = await call(world);
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
  assertUntouched(world);
});
