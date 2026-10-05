import { assertEquals } from "jsr:@std/assert@1";
import { handleReadPage } from "../read-page/handler.ts";
import { ALICE, PAGE_ID, post, readJson, TOKEN_ALICE, World } from "./fakes.ts";

function call(world: World) {
  return handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), world.readDeps());
}

async function failedRead(world: World) {
  world.push(world.failGemini(), world.failGemini());
  return await call(world);
}

Deno.test("the first failed reading queues the page and does not count as a relaunch", async () => {
  const world = new World();
  world.readyPage();
  const response = await failedRead(world);
  assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.page().status, "queued");
  assertEquals(world.page().queueReason, "read_error");
  assertEquals(world.page().retryCount, 0);
});

Deno.test("each failed relaunch is counted and the third one fails the page for good", async () => {
  const world = new World();
  world.readyPage();
  await failedRead(world);
  for (const expected of [1, 2]) {
    const response = await failedRead(world);
    assertEquals(await readJson(response), { status: "queued", queue_reason: "read_error" });
    assertEquals(world.page().status, "queued");
    assertEquals(world.page().retryCount, expected);
  }
  const last = await failedRead(world);
  assertEquals(last.status, 200);
  assertEquals(await readJson(last), { status: "failed" });
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().queueReason, null);
  assertEquals(world.page().retryCount, 3);
  assertEquals(world.geminiImages.length, 8);
  assertEquals(world.charges.length, 1);
  assertEquals(world.deletedPhotos, 0);
  assertEquals(world.photos.size, 1);
});

Deno.test("a page that has failed for good is refused and Gemini is not asked again", async () => {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.page().retryCount = 2;
  await failedRead(world);
  const calls = world.geminiImages.length;
  const response = await call(world);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_failed" });
  assertEquals(world.geminiImages.length, calls);
});

Deno.test("calls repeated on a page that always fails reach Gemini eight times at most and charge once", async () => {
  const world = new World();
  world.readyPage();
  for (let i = 0; i < 20; i++) {
    world.push(world.failGemini(), world.failGemini());
    await call(world);
  }
  assertEquals(world.geminiImages.length, 8);
  assertEquals(world.charges.length, 1);
  assertEquals(world.page().status, "failed");
});

Deno.test("a relaunch that works reads the page and leaves retry_count alone", async () => {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.page().retryCount = 2;
  const response = await call(world);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
  assertEquals(world.page().retryCount, 2);
});

Deno.test("a page at the limit of relaunches fails with retry_count 3, never 4", async () => {
  for (const reason of ["read_error", null] as const) {
    const world = new World();
    world.readyPage();
    world.page().queueReason = reason;
    world.page().retryCount = 3;
    const response = await failedRead(world);
    assertEquals(await readJson(response), { status: "failed" });
    assertEquals(world.page().status, "failed");
    assertEquals(world.page().retryCount, 3);
  }
});

Deno.test("a result that cannot be written counts like a failed reading", async () => {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.page().retryCount = 2;
  world.failOn.add("insertReading");
  const response = await call(world);
  assertEquals(await readJson(response), { status: "failed" });
  assertEquals(world.page().status, "failed");
  assertEquals(world.page().retryCount, 3);
  assertEquals(world.geminiImages.length, 1);
});

Deno.test("the claim names the queue reason and relaunch count that were read, so a stale view cannot claim", async () => {
  const world = new World();
  world.readyPage();
  world.page().queueReason = "read_error";
  world.page().retryCount = 1;
  await call(world);
  assertEquals(world.claimArguments, [[ALICE, PAGE_ID, { queueReason: "read_error", retryCount: 1 }]]);
});

Deno.test("a page whose counters changed since they were read is not claimed", async () => {
  const world = new World();
  world.readyPage();
  const deps = world.readDeps();
  const claim = deps.server.claimForReading;
  deps.server.claimForReading = (userId, pageId, expected) => {
    world.page().queueReason = "read_error";
    world.page().retryCount = 1;
    return claim(userId, pageId, expected);
  };
  const response = await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), deps);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(world.geminiImages, []);
});

Deno.test("a page that fails for good is logged without any content", async () => {
  const world = new World();
  world.readyPage();
  world.page().retryCount = 3;
  await failedRead(world);
  assertEquals(world.logs.at(-1), { event: "read_failed", fields: { pageId: PAGE_ID, code: "relaunches_exhausted" } });
});
