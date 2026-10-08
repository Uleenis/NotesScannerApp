import { assert, assertEquals } from "jsr:@std/assert@1";
import { photoPath } from "../_shared/photo.ts";
import { handleTransferAccount } from "../transfer-account/handler.ts";
import {
  ALICE,
  BOB,
  CANARY_PAGE_TEXT,
  CAROL,
  OPEN_ALLOWANCE,
  OTHER_PAGE_ID,
  PAGE_ID,
  readJson,
  TOKEN_ALICE,
  TOKEN_BOB,
  TOKEN_CAROL,
  transferRequest,
  World,
} from "./fakes.ts";

const SECOND_PAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const THIRD_PAGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function call(world: World, anonymousToken: string | null = TOKEN_ALICE, accountToken: string | null = TOKEN_BOB, body: unknown = {}) {
  return handleTransferAccount(transferRequest(anonymousToken, accountToken, body), world.transferDeps());
}

function scene(): World {
  const world = new World();
  world.anonymousUsers.add(ALICE);
  const history = world.addNotebook(ALICE, "History");
  const physics = world.addNotebook(ALICE, "Physics");
  const intro = world.addChapter(ALICE, history, "Intro");
  for (const [id, notebook, chapter] of [[PAGE_ID, history, intro], [SECOND_PAGE_ID, physics, null]] as const) {
    world.readyPage(ALICE, id);
    world.place(id, notebook, chapter);
    world.pageImages.push({ userId: ALICE, pageId: id, path: photoPath(ALICE, id), kind: "original" });
    world.pageTexts.set(id, { userId: ALICE, text: CANARY_PAGE_TEXT, pipelineVersion: "1" });
    world.charges.push({ userId: ALICE, pageId: id });
    world.readings.push({
      label: "B1",
      rawText: CANARY_PAGE_TEXT,
      model: "model",
      modelVersion: "version",
      promptVersion: "V0",
      thinkingBudget: 0,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      userId: ALICE,
      pageId: id,
    });
  }
  world.addNotebook(BOB, "Chemistry");
  world.readyPage(BOB, OTHER_PAGE_ID);
  world.charges.push({ userId: BOB, pageId: OTHER_PAGE_ID });
  world.addNotebook(CAROL, "History");
  world.readyPage(CAROL, THIRD_PAGE_ID);
  return world;
}

function fingerprint(world: World): string {
  return JSON.stringify({
    pages: [...world.pages],
    photos: [...world.photos.keys()].sort(),
    notebooks: [...world.notebooks],
    chapters: [...world.chapters],
    charges: world.charges,
    images: world.pageImages,
    readings: world.readings,
    texts: [...world.pageTexts],
    deleted: world.deletedUsers,
  });
}

function owned(world: World, userId: string) {
  return {
    pages: [...world.pages.values()].filter((page) => page.userId === userId).map((page) => page.id).sort(),
    photos: [...world.photos.keys()].filter((path) => path.startsWith(`${userId}/`)).sort(),
    notebooks: [...world.notebooks.values()].filter((notebook) => notebook.userId === userId).map((notebook) => notebook.name).sort(),
    chapters: [...world.chapters.values()].filter((chapter) => chapter.userId === userId).length,
    charges: world.charges.filter((charge) => charge.userId === userId).length,
    images: world.pageImages.filter((image) => image.userId === userId).map((image) => image.path).sort(),
    readings: world.readings.filter((reading) => reading.userId === userId).length,
    texts: [...world.pageTexts.values()].filter((text) => text.userId === userId).length,
  };
}

async function refused(response: Response, status: number, code: string) {
  assertEquals(response.status, status);
  assertEquals(await readJson(response), { error: code });
}

Deno.test("transfer-account refuses anything but a POST [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await handleTransferAccount(transferRequest(TOKEN_ALICE, TOKEN_BOB, "", "GET"), world.transferDeps()), 405, "method_not_allowed");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a request without any token [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await call(world, null, null), 401, "unauthenticated");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a request that has the anonymous token only [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await call(world, TOKEN_ALICE, null), 401, "unauthenticated");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a request that has the token of the account found only [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await call(world, null, TOKEN_BOB), 401, "unauthenticated");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a forged or expired token in either place [8]", async () => {
  for (const [anonymous, account] of [["token-forged", TOKEN_BOB], [TOKEN_ALICE, "token-forged"], ["token-forged", "token-forged"]]) {
    const world = scene();
    const before = fingerprint(world);
    await refused(await call(world, anonymous, account), 401, "unauthenticated");
    assertEquals(fingerprint(world), before);
    assertEquals(world.copies, []);
  }
});

Deno.test("transfer-account refuses two tokens of the same account [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await call(world, TOKEN_ALICE, TOKEN_ALICE), 400, "same_account");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a first token that is not the one of an anonymous account [8]", async () => {
  const world = scene();
  const before = fingerprint(world);
  await refused(await call(world, TOKEN_CAROL, TOKEN_BOB), 403, "not_anonymous");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses a second token that is the one of an anonymous account [8]", async () => {
  const world = scene();
  world.anonymousUsers.add(BOB);
  const before = fingerprint(world);
  await refused(await call(world), 403, "target_anonymous");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account refuses while a page of the anonymous account is being read, before any copy [8]", async () => {
  const world = scene();
  world.page(PAGE_ID).status = "processing";
  const before = fingerprint(world);
  await refused(await call(world), 409, "page_processing");
  assertEquals(fingerprint(world), before);
  assertEquals(world.copies, []);
});

Deno.test("transfer-account stops with the same refusal when a reading starts after the check, and keeps everything of the anonymous account [8]", async () => {
  const world = scene();
  world.page(PAGE_ID).status = "processing";
  const deps = world.transferDeps();
  deps.transfers.hasProcessingPage = () => Promise.resolve(false);
  await refused(await handleTransferAccount(transferRequest(TOKEN_ALICE, TOKEN_BOB), deps), 409, "page_processing");
  assertEquals(world.deletedUsers, []);
  assertEquals(owned(world, ALICE).pages, [PAGE_ID, SECOND_PAGE_ID].sort());
  assertEquals(owned(world, ALICE).photos.length, 2);
});

Deno.test("transfer-account refuses a replay once the anonymous account is gone, and leaves what was moved alone [8]", async () => {
  const world = scene();
  assertEquals((await call(world)).status, 200);
  const before = fingerprint(world);
  await refused(await call(world), 401, "unauthenticated");
  assertEquals(fingerprint(world), before);
});

Deno.test("transfer-account moves the rows, the photos, the readings, the texts and the charges, then deletes the anonymous account [9]", async () => {
  const world = scene();
  const bobBefore = owned(world, BOB);
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { transferred: true });
  assertEquals(world.deletedUsers, [ALICE]);

  const alice = owned(world, ALICE);
  assertEquals(alice, { pages: [], photos: [], notebooks: [], chapters: 0, charges: 0, images: [], readings: 0, texts: 0 });

  const bob = owned(world, BOB);
  assertEquals(bob.pages, [OTHER_PAGE_ID, PAGE_ID, SECOND_PAGE_ID].sort());
  assertEquals(bob.notebooks, ["Chemistry", "History", "Physics"]);
  assertEquals(bob.chapters, 1);
  assertEquals(bob.charges, bobBefore.charges + 2);
  assertEquals(bob.readings, 2);
  assertEquals(bob.texts, 2);
  assertEquals(bob.photos, [photoPath(BOB, OTHER_PAGE_ID), photoPath(BOB, PAGE_ID), photoPath(BOB, SECOND_PAGE_ID)].sort());
  assertEquals(bob.images, [photoPath(BOB, PAGE_ID), photoPath(BOB, SECOND_PAGE_ID)].sort());
  assertEquals(world.page(PAGE_ID).chapterId !== null, true);
});

Deno.test("transfer-account makes the photos readable by the account found and no longer by the old one [9]", async () => {
  const world = scene();
  await call(world);
  const bobStore = world.caller(TOKEN_BOB);
  assert(await bobStore.photoInfo(photoPath(BOB, PAGE_ID)));
  assertEquals(await bobStore.photoInfo(photoPath(ALICE, PAGE_ID)), null);
  assertEquals(world.photos.has(photoPath(ALICE, PAGE_ID)), false);
});

Deno.test("transfer-account checks, copies, then moves the rows, then erases the old files, then deletes the account [9]", async () => {
  const world = scene();
  await call(world);
  const names = world.calls.filter((name) => ["hasProcessingPage", "copyPhoto", "moveRows", "removePhotos", "deleteUser"].includes(name));
  assertEquals(names, ["hasProcessingPage", "copyPhoto", "copyPhoto", "moveRows", "removePhotos", "deleteUser"]);
});

Deno.test("transfer-account takes both accounts from the tokens and never from the request [8]", async () => {
  const body = { user_id: CAROL, userId: CAROL, id: CAROL, from: CAROL, to: CAROL, page_id: THIRD_PAGE_ID, account: CAROL };
  for (const sent of [body, "not json", [CAROL], null]) {
    const world = scene();
    const carolBefore = owned(world, CAROL);
    const request = transferRequest(TOKEN_ALICE, TOKEN_BOB, sent);
    request.headers.set("x-user-id", CAROL);
    request.headers.set("x-forwarded-user", CAROL);
    const response = await handleTransferAccount(request, world.transferDeps());
    assertEquals(response.status, 200);
    assertEquals(world.deletedUsers, [ALICE]);
    assertEquals(owned(world, CAROL), carolBefore);
    assertEquals(world.copies.every((copy) => copy.from.startsWith(`${ALICE}/`) && copy.to.startsWith(`${BOB}/`)), true);
  }
});

Deno.test("transfer-account leaves the files, the rows and the account of every other account untouched [9]", async () => {
  const world = scene();
  const carolBefore = owned(world, CAROL);
  await call(world);
  assertEquals(owned(world, CAROL), carolBefore);
  assertEquals(world.deletedUsers.includes(CAROL), false);
  assertEquals(world.deletedUsers.includes(BOB), false);
});

Deno.test("transfer-account joins the notebooks of the same name, spaces at the edges ignored, and keeps the pages of both accounts [9]", async () => {
  const world = scene();
  const bobHistory = world.addNotebook(BOB, " History ");
  world.place(OTHER_PAGE_ID, bobHistory);
  await call(world);
  const history = [...world.notebooks.values()].filter((notebook) => notebook.userId === BOB && notebook.name.trim() === "History");
  assertEquals(history.length, 1);
  assertEquals(history[0].id, bobHistory);
  assertEquals(world.page(PAGE_ID).notebookId, bobHistory);
  assertEquals(world.page(OTHER_PAGE_ID).notebookId, bobHistory);
  assertEquals([...world.chapters.values()].every((chapter) => chapter.notebookId === bobHistory), true);
  assertEquals(owned(world, BOB).pages, [OTHER_PAGE_ID, PAGE_ID, SECOND_PAGE_ID].sort());
});

Deno.test("transfer-account moves a notebook that has no equivalent as it is [9]", async () => {
  const world = scene();
  await call(world);
  assertEquals(owned(world, BOB).notebooks, ["Chemistry", "History", "Physics"]);
});

Deno.test("transfer-account gives the charges to the account found, never charges a page twice and is never stopped by a limit [21]", async () => {
  const world = scene();
  world.allowances.set(BOB, { ...OPEN_ALLOWANCE, used: 15, remaining: 0, blockedReason: "monthly_limit" });
  const before = owned(world, BOB).charges;
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(owned(world, BOB).charges, before + 2);
  assertEquals(owned(world, ALICE).charges, 0);
  const again = await world.server().charge(PAGE_ID);
  assertEquals(again, { allowed: true, reason: "already_charged" });
  assertEquals(owned(world, BOB).charges, before + 2);
});

Deno.test("transfer-account moves more than 100 photos, none left behind [9]", async () => {
  const world = new World();
  world.anonymousUsers.add(ALICE);
  const ids = Array.from({ length: 120 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  for (const id of ids) {
    world.readyPage(ALICE, id);
    world.pageImages.push({ userId: ALICE, pageId: id, path: photoPath(ALICE, id), kind: "original" });
  }
  world.readyPage(BOB, OTHER_PAGE_ID);
  const response = await call(world);
  assertEquals(response.status, 200);
  assertEquals(owned(world, BOB).photos.length, 121);
  assertEquals(owned(world, BOB).pages.length, 121);
  assertEquals(owned(world, BOB).images.length, 120);
  assertEquals(owned(world, ALICE).photos, []);
});

Deno.test("transfer-account keeps everything when a copy fails, and a second try finishes without a duplicate [9]", async () => {
  const world = scene();
  world.failCopyAt = 2;
  const failed = await call(world);
  assertEquals(failed.status, 500);
  assertEquals(await readJson(failed), { error: "internal_error" });
  assertEquals(world.deletedUsers, []);
  assertEquals(world.calls.includes("moveRows"), false);
  assertEquals(owned(world, ALICE).pages, [PAGE_ID, SECOND_PAGE_ID].sort());
  assertEquals(owned(world, ALICE).photos.length, 2);

  world.failCopyAt = null;
  const again = await call(world);
  assertEquals(again.status, 200);
  assertEquals(owned(world, BOB).photos.length, 3);
  assertEquals(owned(world, BOB).pages.length, 3);
  assertEquals(world.deletedUsers, [ALICE]);
});

Deno.test("transfer-account stops before moving any row when a copy did not arrive [9]", async () => {
  const world = scene();
  world.loseCopies = true;
  const response = await call(world);
  assertEquals(response.status, 500);
  assertEquals(world.calls.includes("moveRows"), false);
  assertEquals(world.deletedUsers, []);
  assertEquals(owned(world, ALICE).pages.length, 2);
  assertEquals(owned(world, ALICE).photos.length, 2);
});

Deno.test("transfer-account shows nothing new and loses nothing when the rows cannot be moved, and a second try finishes [9]", async () => {
  const world = scene();
  world.failOn.add("moveRows");
  const failed = await call(world);
  assertEquals(failed.status, 500);
  assertEquals(world.deletedUsers, []);
  assertEquals(owned(world, ALICE).pages.length, 2);
  assertEquals(owned(world, ALICE).photos.length, 2);
  assertEquals(owned(world, BOB).pages, [OTHER_PAGE_ID]);

  world.failOn.clear();
  assertEquals((await call(world)).status, 200);
  assertEquals(owned(world, BOB).pages.length, 3);
  assertEquals(owned(world, BOB).photos.length, 3);
  assertEquals(world.deletedUsers, [ALICE]);
});

Deno.test("transfer-account can be played again when the old files could not be erased [9]", async () => {
  const world = scene();
  world.failOn.add("removePhotos");
  const failed = await call(world);
  assertEquals(failed.status, 500);
  assertEquals(world.deletedUsers, []);
  assertEquals(owned(world, BOB).pages.length, 3);
  assertEquals(owned(world, ALICE).photos.length, 2);

  world.failOn.clear();
  assertEquals((await call(world)).status, 200);
  assertEquals(owned(world, BOB).pages.length, 3);
  assertEquals(owned(world, BOB).photos.length, 3);
  assertEquals(owned(world, BOB).charges, 3);
  assertEquals(owned(world, ALICE).photos, []);
  assertEquals(world.deletedUsers, [ALICE]);
});

Deno.test("transfer-account can be played again when the anonymous account could not be deleted [9]", async () => {
  const world = scene();
  world.failOn.add("deleteUser");
  const failed = await call(world);
  assertEquals(failed.status, 500);
  assertEquals(owned(world, ALICE).photos, []);
  assertEquals(owned(world, BOB).pages.length, 3);

  world.failOn.clear();
  assertEquals((await call(world)).status, 200);
  assertEquals(owned(world, BOB).pages.length, 3);
  assertEquals(owned(world, BOB).photos.length, 3);
  assertEquals(world.deletedUsers.includes(ALICE), true);
});

Deno.test("transfer-account writes one log line with no field [16]", async () => {
  const world = scene();
  await call(world);
  assertEquals(world.logs, [{ event: "account_transferred", fields: {} }]);
});

Deno.test("transfer-account logs a refusal as its code and its status and nothing else [16]", async () => {
  const world = scene();
  await call(world, TOKEN_ALICE, TOKEN_ALICE);
  assertEquals(world.logs.length, 1);
  assertEquals(world.logs[0].event, "refused");
  assertEquals(world.logs[0].fields.code, "same_account");
  assertEquals(world.logs[0].fields.status, 400);
});
