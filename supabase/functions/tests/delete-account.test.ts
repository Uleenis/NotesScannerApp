import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleDeleteAccount } from "../delete-account/handler.ts";
import { ALICE, BOB, OTHER_PAGE_ID, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

function call(world: World, token: string | null, body: unknown = {}) {
  return handleDeleteAccount(post(token, body), world.accountDeps());
}

function twoAccounts(): World {
  const world = new World();
  world.readyPage(ALICE, PAGE_ID);
  world.readyPage(BOB, OTHER_PAGE_ID);
  world.addReadingA(ALICE, PAGE_ID);
  world.addReadingA(BOB, OTHER_PAGE_ID);
  world.models.set(`${ALICE}/1.safetensors`, new Uint8Array([1]));
  world.models.set(`${BOB}/1.safetensors`, new Uint8Array([2]));
  return world;
}

const BUCKETS = ["photos", "alto", "models"] as const;

Deno.test("delete-account refuses a request without a token [10]", async () => {
  const world = twoAccounts();
  const response = await call(world, null);
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertEquals(world.deletedUsers, []);
  assertEquals(world.photos.size + world.alto.size + world.models.size, 6);
});

Deno.test("delete-account refuses a token that does not belong to an account [10]", async () => {
  const world = twoAccounts();
  const response = await call(world, "token-forged");
  assertEquals(response.status, 401);
  assertEquals(world.deletedUsers, []);
  assertEquals(world.photos.size + world.alto.size + world.models.size, 6);
});

Deno.test("delete-account refuses anything but a POST [10]", async () => {
  const world = twoAccounts();
  const response = await handleDeleteAccount(post(TOKEN_ALICE, "", "GET"), world.accountDeps());
  assertEquals(response.status, 405);
  assertEquals(world.deletedUsers, []);
  assertEquals(world.photos.size + world.alto.size + world.models.size, 6);
});

Deno.test("delete-account erases the files and the account of the caller [10]", async () => {
  const world = twoAccounts();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { deleted: true });
  assertEquals(world.deletedUsers, [ALICE]);
  assertEquals([...world.photos.keys()].filter((path) => path.startsWith(`${ALICE}/`)), []);
  assertEquals(world.pages.has(PAGE_ID), false);
});

Deno.test("delete-account erases the ALTO files and the model files of the caller, and their reading A and positions go with the account [14]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(world.filesOf("alto", ALICE), []);
  assertEquals(world.filesOf("models", ALICE), []);
  assertEquals(world.altoReadings.filter((reading) => reading.userId === ALICE), []);
  assertEquals(world.pageTokens.filter((token) => token.userId === ALICE), []);
});

Deno.test("delete-account leaves the files and the rows of every other account untouched [10]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  for (const bucket of BUCKETS) assertEquals(world.filesOf(bucket, BOB).length, 1);
  assertEquals(world.pages.has(OTHER_PAGE_ID), true);
  assertEquals(world.altoReadings.filter((reading) => reading.userId === BOB).length, 1);
  assertEquals(world.pageTokens.filter((token) => token.userId === BOB).length, 2);
  assertEquals(world.deletedUsers.includes(BOB), false);
});

Deno.test("delete-account takes the account from the token and never from the body [10]", async () => {
  for (const body of [{ user_id: BOB, userId: BOB, id: BOB, page_id: OTHER_PAGE_ID }, "not json", [BOB], null]) {
    const world = twoAccounts();
    const response = await call(world, TOKEN_ALICE, body);
    assertEquals(response.status, 200);
    assertEquals(world.deletedUsers, [ALICE]);
    assertEquals(world.pages.has(OTHER_PAGE_ID), true);
  }
});

Deno.test("delete-account erases the files before the account [10]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(
    world.calls.filter((name) => name.startsWith("removeFiles") || name === "deleteUser"),
    ["removeFiles:photos", "removeFiles:alto", "removeFiles:models", "deleteUser"],
  );
});

Deno.test("delete-account keeps the account when the files of any bucket cannot be erased, and a second try works [10]", async () => {
  for (const bucket of BUCKETS) {
    const world = twoAccounts();
    world.failOn.add(`removeFiles:${bucket}`);
    const failed = await call(world, TOKEN_ALICE);
    assertEquals(failed.status, 500);
    assertEquals(await readJson(failed), { error: "internal_error" });
    assertEquals(world.deletedUsers, []);
    assertEquals(world.pages.has(PAGE_ID), true);

    world.failOn.clear();
    const again = await call(world, TOKEN_ALICE);
    assertEquals(again.status, 200);
    assertEquals(world.deletedUsers, [ALICE]);
    for (const each of BUCKETS) assertEquals(world.filesOf(each, ALICE), []);
  }
});

Deno.test("delete-account can be played again when the account itself could not be erased [10]", async () => {
  const world = twoAccounts();
  world.failOn.add("deleteUser");
  const failed = await call(world, TOKEN_ALICE);
  assertEquals(failed.status, 500);
  assertEquals([...world.photos.keys()].filter((path) => path.startsWith(`${ALICE}/`)), []);
  assertEquals(world.pages.has(PAGE_ID), true);

  world.failOn.clear();
  const again = await call(world, TOKEN_ALICE);
  assertEquals(again.status, 200);
  assertEquals(world.deletedUsers, [ALICE]);
  assertEquals(world.pages.has(PAGE_ID), false);
});

Deno.test("delete-account writes one log line with no field [16]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(world.logs, [{ event: "account_deleted", fields: {} }]);
});

Deno.test("delete-account serves two accounts one after the other without mixing them up [10]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  await call(world, TOKEN_BOB);
  assertEquals(world.deletedUsers, [ALICE, BOB]);
  assertEquals(world.photos.size + world.alto.size + world.models.size, 0);
  assert(!world.pages.has(OTHER_PAGE_ID));
});
