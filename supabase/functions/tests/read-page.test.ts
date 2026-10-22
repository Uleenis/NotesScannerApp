import { assertEquals } from "jsr:@std/assert@1";
import { handleReadPage } from "../read-page/handler.ts";
import { photoPath } from "../_shared/photo.ts";
import type { ChargeReason } from "../_shared/ports.ts";
import {
  ALICE,
  BOB,
  JPEG_BYTES,
  MAX_BYTES,
  OPEN_ALLOWANCE,
  PAGE_ID,
  PNG_BYTES,
  post,
  readJson,
  TOKEN_ALICE,
  TOKEN_BOB,
  World,
} from "./fakes.ts";

function call(world: World, token: string | null, body: unknown = { page_id: PAGE_ID }) {
  return handleReadPage(post(token, body), world.readDeps());
}

function assertUntouched(world: World, status: "queued" | "processing" | "read" | "failed" = "queued") {
  assertEquals(world.charges, []);
  assertEquals(world.geminiImages, []);
  assertEquals(world.readings, []);
  assertEquals(world.pageTexts.size, 0);
  assertEquals(world.calls.includes("claim"), false);
  assertEquals(world.page().status, status);
}

Deno.test("read-page reads a ready page and answers read", async () => {
  const world = new World();
  world.readyPage();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { status: "read" });
  assertEquals(world.page().status, "read");
});

Deno.test("read-page refuses a request without a token", async () => {
  const world = new World();
  world.readyPage();
  const response = await call(world, null);
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertUntouched(world);
});

Deno.test("read-page refuses a token that does not belong to an account", async () => {
  const world = new World();
  world.readyPage();
  const response = await call(world, "token-forged");
  assertEquals(response.status, 401);
  assertUntouched(world);
});

Deno.test("read-page refuses anything but a POST", async () => {
  const world = new World();
  world.readyPage();
  const response = await handleReadPage(post(TOKEN_ALICE, "", "GET"), world.readDeps());
  assertEquals(response.status, 405);
  assertUntouched(world);
});

Deno.test("read-page refuses a body that is not a page id", async () => {
  const world = new World();
  world.readyPage();
  for (const body of ["not json", {}, { page_id: 12 }, { page_id: "not-a-uuid" }, [PAGE_ID]]) {
    const response = await call(world, TOKEN_ALICE, body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
  }
  assertUntouched(world);
});

Deno.test("read-page treats the page of another user as not found and touches nothing [14]", async () => {
  const world = new World();
  world.readyPage(ALICE);
  const response = await call(world, TOKEN_BOB);
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "page_not_found" });
  assertUntouched(world);
});

Deno.test("read-page treats an unknown page as not found", async () => {
  const world = new World();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "page_not_found" });
  assertEquals(world.charges, []);
});

Deno.test("read-page still refuses a page of another user when the row rules let it through", async () => {
  const world = new World();
  world.readyPage(BOB);
  world.brokenRowLevelSecurity = true;
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 404);
  assertEquals(world.charges, []);
  assertEquals(world.geminiImages, []);
  assertEquals(world.calls.includes("charge"), false);
});

Deno.test("read-page refuses a page already in processing and counts nothing [14]", async () => {
  const world = new World();
  world.readyPage();
  world.page().status = "processing";
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertUntouched(world, "processing");
});

Deno.test("read-page refuses a page already read", async () => {
  const world = new World();
  world.readyPage();
  world.page().status = "read";
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_already_read" });
  assertUntouched(world, "read");
});

Deno.test("read-page refuses an absent photo [14]", async () => {
  const world = new World();
  world.addPage(ALICE);
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_missing" });
  assertUntouched(world);
  assertEquals(world.pageImages, []);
});

Deno.test("read-page refuses a photo that is not a JPEG by its recorded type, without downloading it [14]", async () => {
  for (const mimeType of ["image/png", "application/octet-stream", null]) {
    const world = new World();
    world.addPage(ALICE);
    world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, mimeType);
    const response = await call(world, TOKEN_ALICE);
    assertEquals(response.status, 422);
    assertEquals(await readJson(response), { error: "photo_not_jpeg" });
    assertEquals(world.calls.includes("download"), false);
    assertUntouched(world);
  }
});

Deno.test("read-page refuses a photo that says JPEG but whose bytes are not [14]", async () => {
  const world = new World();
  world.addPage(ALICE);
  world.addPhoto(ALICE, PAGE_ID, PNG_BYTES, "image/jpeg");
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_not_jpeg" });
  assertUntouched(world);
  assertEquals(world.pageImages, []);
});

Deno.test("read-page refuses a photo of more than 10 MB, without downloading it [14]", async () => {
  const world = new World();
  world.addPage(ALICE);
  world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/jpeg", MAX_BYTES + 1);
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_too_large" });
  assertEquals(world.calls.includes("download"), false);
  assertUntouched(world);
});

Deno.test("read-page accepts a photo of exactly 10 MB", async () => {
  const world = new World();
  world.addPage(ALICE);
  world.addPhoto(ALICE, PAGE_ID, JPEG_BYTES, "image/jpeg", MAX_BYTES);
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
});

Deno.test("read-page looks for the photo under the caller's own folder only", async () => {
  const world = new World();
  world.addPage(ALICE);
  world.addPhoto(BOB, PAGE_ID);
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_missing" });
});

Deno.test("read-page records the original photo once, under the page's folder", async () => {
  const world = new World();
  world.readyPage();
  await call(world, TOKEN_ALICE);
  assertEquals(world.pageImages, [{ userId: ALICE, pageId: PAGE_ID, path: photoPath(ALICE, PAGE_ID), kind: "original" }]);
  assertEquals(photoPath(ALICE, PAGE_ID), `${ALICE}/${PAGE_ID}/original.jpg`);
});

const CHARGE_CASES: [ChargeReason, number, string | null][] = [
  ["monthly_limit", 403, "monthly_limit"],
  ["anonymous_limit", 403, "anonymous_limit"],
  ["anonymous_daily_cap", 403, "anonymous_daily_cap"],
  ["page_not_found", 404, "page_not_found"],
];

for (const [reason, status, code] of CHARGE_CASES) {
  Deno.test(`read-page translates the charge reason ${reason} and leaves the page queued`, async () => {
    const world = new World();
    world.readyPage();
    world.forcedCharge = reason;
    const response = await call(world, TOKEN_ALICE);
    assertEquals(response.status, status);
    assertEquals(await readJson(response), { error: code });
    assertEquals(world.geminiImages, []);
    assertEquals(world.calls.includes("claim"), false);
    assertEquals(world.page().status, "queued");
    assertEquals(world.readings, []);
    assertEquals(world.pageImages, []);
  });
}

for (const reason of ["charged", "already_charged"] as const) {
  Deno.test(`read-page goes on to the reading when the charge reason is ${reason}`, async () => {
    const world = new World();
    world.readyPage();
    world.forcedCharge = reason;
    const response = await call(world, TOKEN_ALICE);
    assertEquals(response.status, 200);
    assertEquals(world.geminiImages.length, 1);
  });
}

Deno.test("read-page checks the owner, then the photo, then charges, then claims, then calls Gemini", async () => {
  const world = new World();
  world.readyPage();
  await call(world, TOKEN_ALICE);
  const order = ["getPage", "photoInfo", "download", "charge", "recordOriginalImage", "claim", "gemini", "gemini_b2", "insertReading", "upsertPageText", "markRead", "insertReadingB2", "mathCheckReadings"];
  assertEquals(world.calls, order);
});

Deno.test("read-page asks for the charge with the page id alone, never a date", async () => {
  const world = new World();
  world.readyPage();
  await call(world, TOKEN_ALICE);
  assertEquals(world.chargeArguments, [[PAGE_ID]]);
});

Deno.test("read-page never refuses an already charged page for a limit reached since", async () => {
  const world = new World();
  world.readyPage();
  world.charges.push({ userId: ALICE, pageId: PAGE_ID });
  world.allowances.set(ALICE, { ...OPEN_ALLOWANCE, used: 15, remaining: 0, blockedReason: "monthly_limit" });
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(world.charges.length, 1);
  assertEquals(world.page().status, "read");
});

Deno.test("read-page charges a page once across a failed reading and its retry [20]", async () => {
  const world = new World();
  world.readyPage();
  world.push(world.failGemini(), world.failGemini());
  const first = await call(world, TOKEN_ALICE);
  assertEquals(await readJson(first), { status: "queued", queue_reason: "read_error" });
  assertEquals(world.charges.length, 1);
  world.allowances.set(ALICE, { ...OPEN_ALLOWANCE, used: 15, remaining: 0, blockedReason: "monthly_limit" });
  const second = await call(world, TOKEN_ALICE);
  assertEquals(second.status, 200);
  assertEquals(await readJson(second), { status: "read" });
  assertEquals(world.charges.length, 1);
  assertEquals(world.pageImages.length, 1);
});

Deno.test("read-page charges once and reads once when two calls arrive together [20]", async () => {
  const world = new World();
  world.readyPage();
  const [a, b] = await Promise.all([call(world, TOKEN_ALICE), call(world, TOKEN_ALICE)]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assertEquals(await readJson(loser), { error: "page_processing" });
  assertEquals(world.charges.length, 1);
  assertEquals(world.geminiImages.length, 1);
  assertEquals(world.readings.filter((reading) => reading.label === "B1").length, 1);
  assertEquals(world.page().status, "read");
});

Deno.test("read-page sends Gemini the original photo bytes", async () => {
  const world = new World();
  world.readyPage();
  await call(world, TOKEN_ALICE);
  assertEquals(world.geminiImages, [JPEG_BYTES]);
});

Deno.test("read-page refuses a photo that disappears between the check and the download, and counts nothing", async () => {
  const world = new World();
  world.readyPage();
  const deps = world.readDeps();
  const forCaller = deps.forCaller;
  deps.forCaller = (token) => ({ ...forCaller(token), downloadPhoto: () => Promise.resolve(null) });
  const response = await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), deps);
  assertEquals(response.status, 422);
  assertEquals(await readJson(response), { error: "photo_missing" });
  assertUntouched(world);
  assertEquals(world.pageImages, []);
});

Deno.test("read-page answers 500 and counts nothing when the accounts service cannot be reached", async () => {
  const world = new World();
  world.readyPage();
  const deps = world.readDeps();
  deps.auth = { verify: () => Promise.reject(new TypeError("unreachable")) };
  const response = await handleReadPage(post(TOKEN_ALICE, { page_id: PAGE_ID }), deps);
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
  assertUntouched(world);
});
