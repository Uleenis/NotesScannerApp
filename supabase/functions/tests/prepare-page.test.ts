import { assertEquals } from "jsr:@std/assert@1";
import { handlePreparePage } from "../prepare-page/handler.ts";
import { ALICE, BOB, CANARY_UPLOAD_TOKEN, OPEN_ALLOWANCE, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

function call(world: World, token: string | null, body: unknown = { page_id: PAGE_ID }) {
  return handlePreparePage(post(token, body), world.prepareDeps());
}

Deno.test("prepare-page refuses a request without a token", async () => {
  const world = new World();
  world.addPage(ALICE);
  const response = await call(world, null);
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-page refuses a token that does not belong to an account", async () => {
  const world = new World();
  world.addPage(ALICE);
  const response = await call(world, "token-forged");
  assertEquals(response.status, 401);
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-page refuses anything but a POST", async () => {
  const world = new World();
  const response = await handlePreparePage(post(TOKEN_ALICE, "", "GET"), world.prepareDeps());
  assertEquals(response.status, 405);
});

Deno.test("prepare-page refuses a body that is not a page id", async () => {
  const world = new World();
  world.addPage(ALICE);
  for (const body of ["not json", {}, { page_id: 12 }, { page_id: "not-a-uuid" }, { page_id: `${PAGE_ID} ` }]) {
    const response = await call(world, TOKEN_ALICE, body);
    assertEquals(response.status, 400);
    assertEquals(await readJson(response), { error: "invalid_request" });
  }
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-page treats the page of another user as not found", async () => {
  const world = new World();
  world.addPage(BOB);
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "page_not_found" });
  assertEquals(world.uploadPaths, []);
});

Deno.test("prepare-page treats an unknown page as not found", async () => {
  const world = new World();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 404);
});

Deno.test("prepare-page refuses a page that is not queued", async () => {
  const expected = { processing: "page_processing", read: "page_already_read", failed: "page_failed" } as const;
  for (const [status, code] of Object.entries(expected)) {
    const world = new World();
    world.addPage(ALICE, status as keyof typeof expected);
    const response = await call(world, TOKEN_ALICE);
    assertEquals(response.status, 409);
    assertEquals(await readJson(response), { error: code });
    assertEquals(world.uploadPaths, []);
  }
});

Deno.test("prepare-page refuses when the photo is already there", async () => {
  const world = new World();
  world.readyPage();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "photo_exists" });
  assertEquals(world.uploadPaths, []);
});

for (const reason of ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"] as const) {
  Deno.test(`prepare-page refuses a page when the allowance is blocked by ${reason}`, async () => {
    const world = new World();
    world.addPage(ALICE);
    world.allowances.set(ALICE, { ...OPEN_ALLOWANCE, remaining: 0, blockedReason: reason });
    const response = await call(world, TOKEN_ALICE);
    assertEquals(response.status, 403);
    assertEquals(await readJson(response), { error: reason });
    assertEquals(world.uploadPaths, []);
  });
}

Deno.test("prepare-page gives an upload address under the caller's own folder and counts nothing", async () => {
  const world = new World();
  world.addPage(ALICE);
  const response = await call(world, TOKEN_ALICE, { page_id: PAGE_ID, path: "../../other/evil.jpg", user_id: BOB });
  const path = `${ALICE}/${PAGE_ID}/original.jpg`;
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), {
    path,
    token: CANARY_UPLOAD_TOKEN,
    signed_url: `http://storage.test/upload/${path}?token=${CANARY_UPLOAD_TOKEN}`,
  });
  assertEquals(world.uploadPaths, [path]);
  assertEquals(world.charges, []);
  assertEquals(world.calls.includes("charge"), false);
  assertEquals(world.calls.includes("gemini"), false);
  assertEquals(world.page().status, "queued");
});

Deno.test("prepare-page checks the page before it asks for the allowance and the address", async () => {
  const world = new World();
  world.addPage(ALICE);
  await call(world, TOKEN_ALICE);
  assertEquals(world.calls, ["getPage", "photoInfo", "allowance", "createUploadUrl"]);
});

Deno.test("prepare-page does not write the upload token to the log", async () => {
  const world = new World();
  world.addPage(ALICE);
  await call(world, TOKEN_ALICE);
  assertEquals(JSON.stringify(world.logs).includes(CANARY_UPLOAD_TOKEN), false);
  assertEquals(JSON.stringify(world.logs).includes(TOKEN_ALICE), false);
});

Deno.test("prepare-page answers 500 and logs only the error name when a dependency throws", async () => {
  const world = new World();
  world.addPage(ALICE);
  world.failOn.add("createUploadUrl");
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "internal_error" });
  assertEquals(world.logs.at(-1), { event: "unexpected_error", fields: { errorName: "Error" } });
});
