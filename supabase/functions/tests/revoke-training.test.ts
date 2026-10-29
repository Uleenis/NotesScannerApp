import { assertEquals } from "jsr:@std/assert@1";
import { handleRevokeTraining } from "../revoke-training/handler.ts";
import { ALICE, BOB, PAGE_ID, post, readJson, TOKEN_ALICE, World } from "./fakes.ts";

const TEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function call(world: World, token: string | null, body: unknown = {}) {
  return handleRevokeTraining(post(token, body), world.revokeDeps());
}

function twoAccounts(): World {
  const world = new World();
  for (const userId of [ALICE, BOB]) {
    world.activeConsents.add(userId);
    world.models.set(`${userId}/model-1.safetensors`, new Uint8Array([1]));
    world.models.set(`${userId}/model-2.safetensors`, new Uint8Array([2]));
    world.photos.set(`${userId}/writing-tests/${TEST_ID}/1.jpg`, { bytes: new Uint8Array([1]), mimeType: "image/jpeg", size: 1 });
    world.photos.set(`${userId}/writing-tests/${TEST_ID}/2.jpg`, { bytes: new Uint8Array([2]), mimeType: "image/jpeg", size: 1 });
  }
  world.readyPage(ALICE, PAGE_ID);
  world.addReadingA(ALICE, PAGE_ID);
  return world;
}

function trainingFilesOf(world: World, userId: string): string[] {
  return [...world.filesOf("models", userId), ...world.filesOf("photos", userId).filter((path) => path.includes("/writing-tests/"))];
}

Deno.test("revoke-training refuses a request without a token [4]", async () => {
  const world = twoAccounts();
  const response = await call(world, null);
  assertEquals(response.status, 401);
  assertEquals(await readJson(response), { error: "unauthenticated" });
  assertEquals(world.revoked, []);
  assertEquals(trainingFilesOf(world, ALICE).length, 4);
});

Deno.test("revoke-training refuses a token that does not belong to an account [4]", async () => {
  const world = twoAccounts();
  const response = await call(world, "token-forged");
  assertEquals(response.status, 401);
  assertEquals(world.revoked, []);
  assertEquals(trainingFilesOf(world, ALICE).length, 4);
});

Deno.test("revoke-training refuses anything but a POST [4]", async () => {
  const world = twoAccounts();
  const response = await handleRevokeTraining(post(TOKEN_ALICE, "", "GET"), world.revokeDeps());
  assertEquals(response.status, 405);
  assertEquals(world.revoked, []);
  assertEquals(trainingFilesOf(world, ALICE).length, 4);
});

Deno.test("revoke-training erases the model files and the writing-test photos of the caller, and withdraws the consent [4]", async () => {
  const world = twoAccounts();
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { revoked: true });
  assertEquals(world.revoked, [ALICE]);
  assertEquals(world.activeConsents.has(ALICE), false);
  assertEquals(trainingFilesOf(world, ALICE), []);
});

Deno.test("revoke-training keeps the photos of the pages and the ALTO files of the caller [4]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(world.filesOf("photos", ALICE).length, 1);
  assertEquals(world.pages.has(PAGE_ID), true);
  assertEquals(world.filesOf("alto", ALICE).length, 1);
});

Deno.test("revoke-training leaves the files and the consent of every other account untouched [4]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(trainingFilesOf(world, BOB).length, 4);
  assertEquals(world.activeConsents.has(BOB), true);
  assertEquals(world.revoked.includes(BOB), false);
});

Deno.test("revoke-training takes the account from the token and never from the body [4]", async () => {
  for (const body of [{ user_id: BOB, userId: BOB, id: BOB }, "not json", [BOB], null]) {
    const world = twoAccounts();
    const response = await call(world, TOKEN_ALICE, body);
    assertEquals(response.status, 200);
    assertEquals(world.revoked, [ALICE]);
    assertEquals(trainingFilesOf(world, BOB).length, 4);
  }
});

Deno.test("revoke-training erases the files before the rows, and once more after [4]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(
    world.calls.filter((name) => name === "removeTrainingFiles" || name === "revoke"),
    ["removeTrainingFiles", "revoke", "removeTrainingFiles"],
  );
});

Deno.test("revoke-training erases a test photo that landed while the rows were being withdrawn [4]", async () => {
  const world = twoAccounts();
  world.beforeRevoke = () => {
    world.photos.set(`${ALICE}/writing-tests/${TEST_ID}/late.jpg`, { bytes: new Uint8Array([9]), mimeType: "image/jpeg", size: 1 });
    world.models.set(`${ALICE}/late.safetensors`, new Uint8Array([9]));
  };
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(trainingFilesOf(world, ALICE), []);
  assertEquals(trainingFilesOf(world, BOB).length, 4);
});

Deno.test("revoke-training keeps the consent when the first erase fails, and a second try works [4]", async () => {
  const world = twoAccounts();
  world.failOn.add("removeTrainingFiles");
  const failed = await call(world, TOKEN_ALICE);
  assertEquals(failed.status, 500);
  assertEquals(await readJson(failed), { error: "internal_error" });
  assertEquals(world.revoked, []);
  assertEquals(world.activeConsents.has(ALICE), true);

  world.failOn.clear();
  const again = await call(world, TOKEN_ALICE);
  assertEquals(again.status, 200);
  assertEquals(world.revoked, [ALICE]);
  assertEquals(trainingFilesOf(world, ALICE), []);
});

Deno.test("revoke-training can be played again when the rows could not be withdrawn [4]", async () => {
  const world = twoAccounts();
  world.failOn.add("revoke");
  const failed = await call(world, TOKEN_ALICE);
  assertEquals(failed.status, 500);
  assertEquals(world.activeConsents.has(ALICE), true);
  assertEquals(trainingFilesOf(world, ALICE), []);

  world.failOn.clear();
  const again = await call(world, TOKEN_ALICE);
  assertEquals(again.status, 200);
  assertEquals(world.activeConsents.has(ALICE), false);
});

Deno.test("revoke-training answers revoked when only the last erase fails, and logs it with no identifier [4]", async () => {
  const world = twoAccounts();
  world.beforeRevoke = () => {
    world.models.set(`${ALICE}/late.safetensors`, new Uint8Array([9]));
    world.failOn.add("removeTrainingFiles");
  };
  const response = await call(world, TOKEN_ALICE);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { revoked: true });
  assertEquals(world.activeConsents.has(ALICE), false);
  assertEquals(world.logs, [{ event: "training_revoked", fields: {} }, { event: "training_files_left", fields: {} }]);
});

Deno.test("revoke-training writes one log line with no field [4]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  assertEquals(world.logs, [{ event: "training_revoked", fields: {} }]);
});

Deno.test("revoke-training withdraws a second time without error and without a consent [4]", async () => {
  const world = twoAccounts();
  await call(world, TOKEN_ALICE);
  const again = await call(world, TOKEN_ALICE);
  assertEquals(again.status, 200);
  assertEquals(await readJson(again), { revoked: true });
});
