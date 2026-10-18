import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleSetPageType } from "../set-page-type/handler.ts";
import {
  ALICE,
  BOB,
  CANARY_PAGE_TEXT,
  fakeAnswer,
  JPEG_BYTES,
  PAGE_ID,
  post,
  readJson,
  TOKEN_ALICE,
  TOKEN_BOB,
  World,
} from "./fakes.ts";

const B1 = `${CANARY_PAGE_TEXT} et la suite`;

function readPageOf(world: World, pageType: "text" | "math", withA: boolean, owner: string = ALICE): void {
  world.addPage(owner, "read");
  world.addPhoto(owner, PAGE_ID);
  world.page().pageType = pageType;
  world.addB1(owner, PAGE_ID, B1);
  if (withA) world.addReadingA(owner, PAGE_ID);
}

function withService(): World {
  const world = new World();
  world.serviceConfigured = true;
  return world;
}

function ask(world: World, body: unknown, token: string | null = TOKEN_ALICE, method = "POST") {
  return handleSetPageType(post(token, body, method), world.pageTypeDeps());
}

function events(world: World) {
  return world.logs.map((record) => record.event);
}

Deno.test("to math erases A, its positions and its ALTO file, and charges nothing [9]", async () => {
  const world = withService();
  readPageOf(world, "text", true);
  const response = await ask(world, { page_id: PAGE_ID, page_type: "math" });
  await world.settle();
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { page_type: "math" });
  assertEquals(world.page().pageType, "math");
  assertEquals(world.altoReadings, []);
  assertEquals(world.pageTokens, []);
  assertEquals(world.filesOf("alto", ALICE), []);
  assertEquals(world.charges, []);
  assert(!world.calls.includes("gemini"));
  assert(!world.calls.includes("recognize"));
});

Deno.test("to text reads A again from the stored photo and the stored B1, with no charge and no Gemini [9]", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { page_type: "text" });
  assertEquals(world.page().pageType, "text");
  assertEquals(world.recognitions.map((r) => [r.pageId, r.image]), [[PAGE_ID, JPEG_BYTES]]);
  assertEquals(world.arbitrations.map((a) => [a.pageId, a.userId, a.b1, a.answer]), [[PAGE_ID, ALICE, B1, fakeAnswer(PAGE_ID)]]);
  assertEquals(world.charges, []);
  assertEquals(world.chargeArguments, []);
  assert(!world.calls.includes("gemini"));
});

Deno.test("to text answers before A is done", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  world.recognizeOutcomes.push("hold");
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  assertEquals(response.status, 200);
  assertEquals(world.arbitrations, []);
  world.release();
  await world.settle();
  assertEquals(world.arbitrations.length, 1);
});

Deno.test("a failure of the service is tried once more, then the page stays text with B1 alone", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  world.recognizeOutcomes.push({ ok: false, failure: { kind: "network" } }, { ok: false, failure: { kind: "network" } });
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(response.status, 200);
  assertEquals(world.recognitions.length, 2);
  assertEquals(world.arbitrations, []);
  assertEquals(world.page().pageType, "text");
  assertEquals(world.logs.at(-1)?.event, "a_abandoned");
});

Deno.test("switching to math while A is being read keeps A from being written", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  world.recognizeOutcomes.push("hold");
  await ask(world, { page_id: PAGE_ID, page_type: "text" });
  const back = await ask(world, { page_id: PAGE_ID, page_type: "math" });
  assertEquals(back.status, 200);
  world.release();
  await world.settle();
  assertEquals(world.page().pageType, "math");
  assertEquals(world.altoReadings, []);
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "not_text" } });
});

Deno.test("without a reading service the switch to text stands, no A is read and none of its readings is used up", async () => {
  const world = new World();
  readPageOf(world, "math", false);
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(response.status, 200);
  assertEquals(world.page().pageType, "text");
  assertEquals(world.recognitions, []);
  assertEquals(world.page().aRelaunches, 0);
  assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "no_service" } });
});

Deno.test("a switch to the type the page already has changes nothing", async () => {
  for (const pageType of ["text", "math"] as const) {
    const world = withService();
    readPageOf(world, pageType, pageType === "text");
    const response = await ask(world, { page_id: PAGE_ID, page_type: pageType });
    await world.settle();
    assertEquals(response.status, 200, pageType);
    assertEquals(world.page().pageType, pageType);
    assertEquals(world.recognitions, []);
    assertEquals(world.altoReadings.length, pageType === "text" ? 1 : 0);
  }
});

Deno.test("the page of another is refused and left as it is [14]", async () => {
  for (const pageType of ["text", "math"] as const) {
    const world = withService();
    readPageOf(world, pageType === "text" ? "math" : "text", pageType === "math", BOB);
    const response = await ask(world, { page_id: PAGE_ID, page_type: pageType });
    await world.settle();
    assertEquals(response.status, 404, pageType);
    assertEquals(await readJson(response), { error: "page_not_found" });
    assertEquals(world.page().pageType, pageType === "text" ? "math" : "text");
    assertEquals(world.recognitions, []);
  }
});

Deno.test("a page not read yet, or in an unsupported script, is refused [14]", async () => {
  const unread = withService();
  unread.readyPage();
  const first = await ask(unread, { page_id: PAGE_ID, page_type: "math" });
  assertEquals([first.status, await readJson(first)], [409, { error: "page_not_read" }]);

  for (const pageType of ["text", "math"] as const) {
    const world = withService();
    readPageOf(world, "text", false);
    world.page().pageType = "unsupported_script";
    const response = await ask(world, { page_id: PAGE_ID, page_type: pageType });
    assertEquals([response.status, await readJson(response)], [409, { error: "unsupported_script" }], pageType);
    assertEquals(world.page().pageType, "unsupported_script");
  }
});

Deno.test("the client cannot ask for unsupported_script, nor anything but a page and a type [14]", async () => {
  for (const body of [
    { page_id: PAGE_ID, page_type: "unsupported_script" },
    { page_id: PAGE_ID },
    { page_type: "math" },
    { page_id: "not-a-page", page_type: "math" },
    { page_id: PAGE_ID, page_type: "math", user_id: BOB },
    [PAGE_ID, "math"],
  ]) {
    const world = withService();
    readPageOf(world, "text", true);
    const response = await ask(world, body);
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals(world.page().pageType, "text");
  }
});

Deno.test("only a signed-in caller and POST are let in", async () => {
  const world = withService();
  readPageOf(world, "text", true);
  assertEquals((await ask(world, { page_id: PAGE_ID, page_type: "math" }, null)).status, 401);
  assertEquals((await ask(world, { page_id: PAGE_ID, page_type: "math" }, "token-nobody")).status, 401);
  assertEquals((await ask(world, { page_id: PAGE_ID, page_type: "math" }, TOKEN_BOB)).status, 404);
  assertEquals((await ask(world, { page_id: PAGE_ID, page_type: "math" }, TOKEN_ALICE, "GET")).status, 405);
  assertEquals(world.page().pageType, "text");
});

Deno.test("an ALTO file that cannot be erased is logged and the switch stands", async () => {
  const world = withService();
  readPageOf(world, "text", true);
  world.failOn.add("removeAlto");
  const response = await ask(world, { page_id: PAGE_ID, page_type: "math" });
  assertEquals(response.status, 200);
  assertEquals(world.page().pageType, "math");
  assert(events(world).includes("alto_left"));
});

Deno.test("the logs carry neither B1 nor the photo", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await ask(world, { page_id: PAGE_ID, page_type: "math" });
  await world.settle();
  const text = JSON.stringify(world.logs);
  assert(!text.includes(CANARY_PAGE_TEXT));
  assert(!text.includes(ALICE));
  assert(text.includes(PAGE_ID));
});

Deno.test("A is read again at most once in ten minutes for a page, and the switch still stands", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await ask(world, { page_id: PAGE_ID, page_type: "math" });
  const again = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(again.status, 200);
  assertEquals(world.page().pageType, "text");
  assertEquals(world.recognitions.length, 1);
  assert(world.logs.some((record) => record.event === "a_abandoned" && record.fields.code === "relaunch_limit"));

  world.clock += 11 * 60_000;
  await ask(world, { page_id: PAGE_ID, page_type: "math" });
  await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(world.recognitions.length, 2);
});

Deno.test("A is read again three times at most for a page", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  for (let round = 0; round < 5; round++) {
    await ask(world, { page_id: PAGE_ID, page_type: "text" });
    await ask(world, { page_id: PAGE_ID, page_type: "math" });
    world.clock += 11 * 60_000;
  }
  await world.settle();
  assertEquals(world.recognitions.length, 3);
});

Deno.test("a photo missing or not a JPEG leaves the page text without A", async () => {
  for (const bytes of [null, new Uint8Array([1, 2, 3, 4])]) {
    const world = withService();
    readPageOf(world, "math", false);
    if (bytes === null) world.photos.clear();
    else world.addPhoto(ALICE, PAGE_ID, bytes);
    const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
    await world.settle();
    assertEquals(response.status, 200);
    assertEquals(world.page().pageType, "text");
    assertEquals(world.recognitions, []);
    assertEquals(world.logs.at(-1), { event: "a_abandoned", fields: { pageId: PAGE_ID, code: "photo_missing" } });
  }
});

Deno.test("a photo that cannot be downloaded leaves the page text without A, and the switch is answered", async () => {
  const world = withService();
  readPageOf(world, "math", false);
  world.failOn.add("download");
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  await world.settle();
  assertEquals(response.status, 200);
  assertEquals(world.page().pageType, "text");
  assertEquals(world.recognitions, []);
  assertEquals(world.logs.at(-1)?.event, "a_abandoned");
  assertEquals(world.logs.at(-1)?.fields.code, "photo_unreadable");
});

Deno.test("a page of math without B1 is not switched to text", async () => {
  const world = withService();
  world.addPage(ALICE, "read");
  world.addPhoto(ALICE, PAGE_ID);
  world.page().pageType = "math";
  const response = await ask(world, { page_id: PAGE_ID, page_type: "text" });
  assertEquals([response.status, await readJson(response)], [409, { error: "no_reading" }]);
  assertEquals(world.page().pageType, "math");
});
