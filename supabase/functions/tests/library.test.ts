import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleDeleteChapter } from "../delete-chapter/handler.ts";
import { handleDeleteNotebook } from "../delete-notebook/handler.ts";
import { handleDeletePage } from "../delete-page/handler.ts";
import { handleMovePage } from "../move-page/handler.ts";
import { ALICE, BOB, OTHER_PAGE_ID, PAGE_ID, post, readJson, TOKEN_ALICE, TOKEN_BOB, World } from "./fakes.ts";

const NOTEBOOK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECOND_NOTEBOOK = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const BOB_NOTEBOOK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHAPTER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SECOND_CHAPTER = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const BOB_CHAPTER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const LOOSE_PAGE = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const KEPT_PAGE = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function library(): World {
  const world = new World();
  world.addNotebook(ALICE, "Alice notebook", NOTEBOOK);
  world.addNotebook(ALICE, "Alice second", SECOND_NOTEBOOK);
  world.addNotebook(BOB, "Bob notebook", BOB_NOTEBOOK);
  world.addChapter(ALICE, NOTEBOOK, "Intro", CHAPTER);
  world.addChapter(ALICE, SECOND_NOTEBOOK, "Other", SECOND_CHAPTER);
  world.addChapter(BOB, BOB_NOTEBOOK, "Bob chapter", BOB_CHAPTER);
  world.readyPage(ALICE, PAGE_ID);
  world.readyPage(ALICE, LOOSE_PAGE);
  world.readyPage(ALICE, KEPT_PAGE);
  world.readyPage(BOB, OTHER_PAGE_ID);
  for (const id of [PAGE_ID, LOOSE_PAGE, KEPT_PAGE, OTHER_PAGE_ID]) {
    world.page(id).status = "read";
    world.addB1(world.page(id).userId, id, "text");
    world.addReadingA(world.page(id).userId, id);
    world.charges.push({ userId: world.page(id).userId, pageId: id });
    world.pageTexts.set(id, { userId: world.page(id).userId, text: "text", pipelineVersion: "v" });
    world.pageImages.push({ userId: world.page(id).userId, pageId: id, path: `${world.page(id).userId}/${id}/original.jpg`, kind: "original" });
  }
  world.place(PAGE_ID, NOTEBOOK, CHAPTER);
  world.place(LOOSE_PAGE, NOTEBOOK, null);
  world.place(KEPT_PAGE, SECOND_NOTEBOOK, null);
  world.place(OTHER_PAGE_ID, BOB_NOTEBOOK, BOB_CHAPTER);
  world.calls.length = 0;
  return world;
}

const deletePage = (world: World, token: string | null, body: unknown) => handleDeletePage(post(token, body), world.libraryDeps());
const deleteNotebook = (world: World, token: string | null, body: unknown) => handleDeleteNotebook(post(token, body), world.libraryDeps());
const deleteChapter = (world: World, token: string | null, body: unknown) => handleDeleteChapter(post(token, body), world.libraryDeps());
const movePage = (world: World, token: string | null, body: unknown) => handleMovePage(post(token, body), world.libraryDeps());

function stateOf(world: World) {
  return JSON.stringify({
    pages: [...world.pages.values()],
    notebooks: [...world.notebooks.values()],
    chapters: [...world.chapters.values()],
    photos: [...world.photos.keys()],
    alto: [...world.alto.keys()],
    texts: [...world.pageTexts.keys()],
    readings: world.readings.length,
    charges: world.charges,
  });
}

const CASES = [
  { name: "delete-page", call: deletePage, body: { page_id: PAGE_ID } },
  { name: "delete-notebook", call: deleteNotebook, body: { notebook_id: NOTEBOOK } },
  { name: "delete-chapter", call: deleteChapter, body: { chapter_id: CHAPTER } },
  { name: "move-page", call: movePage, body: { page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK, chapter_id: null } },
];

for (const { name, call, body } of CASES) {
  Deno.test(`${name} refuses a request without a token, with a forged token, or that is not a POST [6]`, async () => {
    const world = library();
    const before = stateOf(world);
    const none = await call(world, null, body);
    assertEquals(none.status, 401);
    assertEquals(await readJson(none), { error: "unauthenticated" });
    assertEquals((await call(world, "token-forged", body)).status, 401);
    const get = await (name === "delete-page" ? handleDeletePage : name === "delete-notebook" ? handleDeleteNotebook : name === "delete-chapter" ? handleDeleteChapter : handleMovePage)(
      post(TOKEN_ALICE, "", "GET"),
      world.libraryDeps(),
    );
    assertEquals(get.status, 405);
    assertEquals(stateOf(world), before);
    assertEquals(world.calls, []);
  });

  Deno.test(`${name} refuses a body that holds anything but its own fields, and takes no owner from it [6]`, async () => {
    for (const extra of [{ user_id: BOB }, { userId: BOB }, { id: UNKNOWN }]) {
      const world = library();
      const before = stateOf(world);
      const response = await call(world, TOKEN_ALICE, { ...body, ...extra });
      assertEquals(response.status, 400);
      assertEquals(await readJson(response), { error: "invalid_request" });
      assertEquals(stateOf(world), before);
    }
    for (const bad of ["not json", [], null, 7, {}]) {
      const world = library();
      const before = stateOf(world);
      assertEquals((await call(world, TOKEN_ALICE, bad)).status, 400);
      assertEquals(stateOf(world), before);
    }
    for (const key of Object.keys(body)) {
      for (const wrong of ["not-a-uuid", 12, "", UNKNOWN.toUpperCase().slice(1)]) {
        const world = library();
        const before = stateOf(world);
        assertEquals((await call(world, TOKEN_ALICE, { ...body, [key]: wrong })).status, 400);
        assertEquals(stateOf(world), before);
      }
    }
  });
}

Deno.test("delete-page erases the rows, the photo and the ALTO of the page, and keeps its charge [4]", async () => {
  const world = library();
  const response = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { deleted: true });
  assertEquals(world.pages.has(PAGE_ID), false);
  assertEquals(world.pageTexts.has(PAGE_ID), false);
  assertEquals(world.readings.filter((reading) => reading.pageId === PAGE_ID), []);
  assertEquals(world.pageTokens.filter((token) => token.pageId === PAGE_ID), []);
  assertEquals([...world.photos.keys()].filter((path) => path.includes(PAGE_ID)), []);
  assertEquals([...world.alto.keys()].filter((path) => path.includes(PAGE_ID)), []);
  assertEquals(world.charges.length, 4);
  assertEquals(world.charges.filter((charge) => charge.pageId === ""), [{ userId: ALICE, pageId: "" }]);
});

Deno.test("delete-page leaves every other page of the owner and of anyone else untouched [4]", async () => {
  const world = library();
  await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals([...world.pages.keys()].sort(), [LOOSE_PAGE, KEPT_PAGE, OTHER_PAGE_ID].sort());
  assertEquals(world.photos.size, 3);
  assertEquals(world.alto.size, 3);
  assertEquals(world.chapters.size, 3);
  assertEquals(world.notebooks.size, 3);
});

Deno.test("delete-page erases every file in the folder of the page, whatever it is named [4]", async () => {
  const world = library();
  world.photos.set(`${ALICE}/${PAGE_ID}/stray.jpg`, { bytes: new Uint8Array([1]), mimeType: null, size: 1 });
  world.alto.set(`${ALICE}/${PAGE_ID}/a-orphan.xml`, new Uint8Array([1]));
  world.alto.set(`${ALICE}/${LOOSE_PAGE}/a-keep.xml`, new Uint8Array([1]));
  await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(world.filesOf("photos", ALICE).filter((path) => path.includes(PAGE_ID)), []);
  assertEquals(world.filesOf("alto", ALICE).filter((path) => path.includes(PAGE_ID)), []);
  assertEquals(world.alto.has(`${ALICE}/${LOOSE_PAGE}/a-keep.xml`), true);
});

Deno.test("delete-page refuses the page of another account and a page that does not exist, and touches nothing [6]", async () => {
  for (const pageId of [OTHER_PAGE_ID, UNKNOWN]) {
    const world = library();
    const before = stateOf(world);
    const response = await deletePage(world, TOKEN_ALICE, { page_id: pageId });
    assertEquals(response.status, 404);
    assertEquals(await readJson(response), { error: "page_not_found" });
    assertEquals(stateOf(world), before);
    assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles")), []);
  }
});

Deno.test("delete-page refuses a page being read before it erases anything [6]", async () => {
  const world = library();
  world.page(PAGE_ID).status = "processing";
  const before = stateOf(world);
  const response = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(stateOf(world), before);
  assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles") || name === "deletePage"), []);
});

Deno.test("delete-page erases the files before the rows, then the photo and the ALTO files once more [4][9]", async () => {
  const world = library();
  await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(
    world.calls.filter((name) => name.startsWith("removePageFiles") || name === "deletePage"),
    ["removePageFiles:photos", "removePageFiles:alto", "deletePage", "removePageFiles:photos", "removePageFiles:alto"],
  );
});

Deno.test("delete-page erases an ALTO file that a reading A uploaded while the page was being deleted [9]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.alto.set(`${ALICE}/${PAGE_ID}/a-late.xml`, new Uint8Array([1]));
  };
  const response = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(response.status, 200);
  assertEquals(world.filesOf("alto", ALICE).filter((path) => path.includes(PAGE_ID)), []);
});

Deno.test("delete-page erases a photo that landed while the page was being deleted [4]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.photos.set(`${ALICE}/${PAGE_ID}/late.jpg`, { bytes: new Uint8Array([1]), mimeType: null, size: 1 });
  };
  assertEquals((await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID })).status, 200);
  assertEquals(world.filesOf("photos", ALICE).filter((path) => path.includes(PAGE_ID)), []);
});

Deno.test("delete-page answers 409 when the page started a reading between the check and the deletion, and a second try works once it is over [6]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.page(PAGE_ID).status = "processing";
    world.beforeLibraryCall = null;
  };
  const response = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(response.status, 409);
  assertEquals(world.pages.has(PAGE_ID), true);
  world.page(PAGE_ID).status = "read";
  assertEquals((await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID })).status, 200);
  assertEquals(world.pages.has(PAGE_ID), false);
});

Deno.test("delete-page keeps the rows when a file cannot be erased, and a second try works [4]", async () => {
  for (const name of ["removePageFiles:photos", "removePageFiles:alto"]) {
    const world = library();
    world.failOn.add(name);
    const failed = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
    assertEquals(failed.status, 500);
    assertEquals(await readJson(failed), { error: "internal_error" });
    assertEquals(world.pages.has(PAGE_ID), true);
    world.failOn.clear();
    assertEquals((await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID })).status, 200);
    assertEquals(world.pages.has(PAGE_ID), false);
  }
});

Deno.test("delete-page answers deleted when only the last erase of the ALTO files fails, and logs it [9]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.failOn.add("removePageFiles:alto");
  };
  const response = await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(response.status, 200);
  assertEquals(world.pages.has(PAGE_ID), false);
  assertEquals(world.logs.map((log) => log.event), ["page_deleted", "files_left"]);
});

Deno.test("delete-page logs the page and nothing else [4]", async () => {
  const world = library();
  await deletePage(world, TOKEN_ALICE, { page_id: PAGE_ID });
  assertEquals(world.logs, [{ event: "page_deleted", fields: { pageId: PAGE_ID } }]);
});

Deno.test("delete-notebook erases the notebook, its chapters, its pages, their rows, photos and ALTO files, and keeps the charges [2]", async () => {
  const world = library();
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { deleted: true });
  assertEquals(world.notebooks.has(NOTEBOOK), false);
  assertEquals(world.chapters.has(CHAPTER), false);
  for (const id of [PAGE_ID, LOOSE_PAGE]) {
    assertEquals(world.pages.has(id), false);
    assertEquals(world.pageTexts.has(id), false);
    assertEquals([...world.photos.keys()].filter((path) => path.includes(id)), []);
    assertEquals([...world.alto.keys()].filter((path) => path.includes(id)), []);
    assertEquals(world.readings.filter((reading) => reading.pageId === id), []);
    assertEquals(world.pageTokens.filter((token) => token.pageId === id), []);
  }
  assertEquals(world.charges.length, 4);
  assertEquals(world.charges.filter((charge) => charge.pageId === "").length, 2);
});

Deno.test("delete-notebook leaves the other notebooks, chapters and pages of the owner and of anyone else untouched [2]", async () => {
  const world = library();
  await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals([...world.notebooks.keys()].sort(), [SECOND_NOTEBOOK, BOB_NOTEBOOK].sort());
  assertEquals([...world.chapters.keys()].sort(), [SECOND_CHAPTER, BOB_CHAPTER].sort());
  assertEquals([...world.pages.keys()].sort(), [KEPT_PAGE, OTHER_PAGE_ID].sort());
  assertEquals(world.photos.size, 2);
  assertEquals(world.alto.size, 2);
});

Deno.test("delete-notebook deletes an empty notebook [2]", async () => {
  const world = library();
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: SECOND_NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(world.pages.has(KEPT_PAGE), false);
  const empty = world.addNotebook(ALICE, "Empty", "12121212-1212-4121-8121-121212121212");
  assertEquals((await deleteNotebook(world, TOKEN_ALICE, { notebook_id: empty })).status, 200);
  assertEquals(world.notebooks.has(empty), false);
});

Deno.test("delete-notebook erases the files of every page of a large notebook [2]", async () => {
  const world = library();
  const ids = Array.from({ length: 40 }, (_, index) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`);
  for (const id of ids) {
    world.readyPage(ALICE, id);
    world.page(id).status = "read";
    world.place(id, NOTEBOOK);
    world.addReadingA(ALICE, id);
  }
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(world.filesOf("photos", ALICE).length, 1);
  assertEquals(world.filesOf("alto", ALICE).length, 1);
  assertEquals(world.pages.size, 2);
});

Deno.test("delete-notebook refuses the notebook of another account and one that does not exist, and touches nothing [6]", async () => {
  for (const notebookId of [BOB_NOTEBOOK, UNKNOWN]) {
    const world = library();
    const before = stateOf(world);
    const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: notebookId });
    assertEquals(response.status, 404);
    assertEquals(await readJson(response), { error: "notebook_not_found" });
    assertEquals(stateOf(world), before);
    assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles")), []);
  }
});

Deno.test("delete-notebook refuses while one of its pages is being read, before it erases anything [6]", async () => {
  const world = library();
  world.page(LOOSE_PAGE).status = "processing";
  const before = stateOf(world);
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(stateOf(world), before);
  assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles") || name === "deleteNotebook"), []);
});

Deno.test("delete-notebook answers 409 when a page started a reading between the check and the deletion [6]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.page(LOOSE_PAGE).status = "processing";
  };
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 409);
  assertEquals(world.notebooks.has(NOTEBOOK), true);
  assertEquals(world.pages.has(LOOSE_PAGE), true);
});

Deno.test("delete-notebook erases the files before the rows, then the photos and the ALTO files once more [2][9]", async () => {
  const world = library();
  await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  const names = world.calls.filter((name) => name.startsWith("removePageFiles") || name === "deleteNotebook");
  const rows = names.indexOf("deleteNotebook");
  assertEquals(names.slice(0, rows).filter((name) => name === "removePageFiles:photos").length, 2);
  assertEquals(names.slice(0, rows).filter((name) => name === "removePageFiles:alto").length, 2);
  assertEquals(names.slice(rows + 1).sort(), ["removePageFiles:alto", "removePageFiles:alto", "removePageFiles:photos", "removePageFiles:photos"]);
});

Deno.test("delete-notebook erases the files of a page that came into the notebook after the list was read [2]", async () => {
  const world = library();
  const late = "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4";
  world.beforeLibraryCall = () => {
    world.readyPage(ALICE, late);
    world.page(late).status = "read";
    world.place(late, NOTEBOOK);
    world.addReadingA(ALICE, late);
  };
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(world.pages.has(late), false);
  assertEquals(world.filesOf("photos", ALICE).filter((path) => path.includes(late)), []);
  assertEquals(world.filesOf("alto", ALICE).filter((path) => path.includes(late)), []);
  assertEquals(world.photos.has(`${ALICE}/${KEPT_PAGE}/original.jpg`), true);
});

Deno.test("delete-notebook erases a photo that landed while the notebook was being deleted [2]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.photos.set(`${ALICE}/${LOOSE_PAGE}/late.jpg`, { bytes: new Uint8Array([1]), mimeType: null, size: 1 });
  };
  assertEquals((await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK })).status, 200);
  assertEquals(world.filesOf("photos", ALICE).filter((path) => path.includes(LOOSE_PAGE)), []);
});

Deno.test("delete-notebook erases an ALTO file that a reading A uploaded while the notebook was being deleted [9]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.alto.set(`${ALICE}/${PAGE_ID}/a-late.xml`, new Uint8Array([1]));
  };
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(world.filesOf("alto", ALICE).filter((path) => path.includes(PAGE_ID)), []);
});

Deno.test("delete-notebook keeps the rows when a file cannot be erased, and a second try works [2]", async () => {
  for (const name of ["removePageFiles:photos", "removePageFiles:alto"]) {
    const world = library();
    world.failOn.add(name);
    const failed = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
    assertEquals(failed.status, 500);
    assertEquals(world.notebooks.has(NOTEBOOK), true);
    assertEquals(world.pages.has(PAGE_ID), true);
    world.failOn.clear();
    assertEquals((await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK })).status, 200);
    assertEquals(world.notebooks.has(NOTEBOOK), false);
  }
});

Deno.test("delete-notebook answers deleted when only the last erase of the ALTO files fails, and logs it [9]", async () => {
  const world = library();
  world.beforeLibraryCall = () => {
    world.failOn.add("removePageFiles:alto");
  };
  const response = await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(response.status, 200);
  assertEquals(world.notebooks.has(NOTEBOOK), false);
  assertEquals(world.logs.map((log) => log.event), ["notebook_deleted", "files_left"]);
});

Deno.test("delete-notebook logs no identifier [2]", async () => {
  const world = library();
  await deleteNotebook(world, TOKEN_ALICE, { notebook_id: NOTEBOOK });
  assertEquals(world.logs, [{ event: "notebook_deleted", fields: {} }]);
});

Deno.test("delete-chapter erases the chapter and keeps its pages, out of any chapter, and touches no file [3]", async () => {
  const world = library();
  const response = await deleteChapter(world, TOKEN_ALICE, { chapter_id: CHAPTER });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { deleted: true });
  assertEquals(world.chapters.has(CHAPTER), false);
  assertEquals(world.pages.has(PAGE_ID), true);
  assertEquals(world.page(PAGE_ID).chapterId, null);
  assertEquals(world.page(PAGE_ID).notebookId, NOTEBOOK);
  assertEquals(world.photos.size, 4);
  assertEquals(world.alto.size, 4);
  assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles")), []);
  assertEquals(world.chapters.size, 2);
});

Deno.test("delete-chapter refuses the chapter of another account and one that does not exist, and touches nothing [6]", async () => {
  for (const chapterId of [BOB_CHAPTER, UNKNOWN]) {
    const world = library();
    const before = stateOf(world);
    const response = await deleteChapter(world, TOKEN_ALICE, { chapter_id: chapterId });
    assertEquals(response.status, 404);
    assertEquals(await readJson(response), { error: "chapter_not_found" });
    assertEquals(stateOf(world), before);
  }
});

Deno.test("delete-chapter keeps a chapter whose erase failed, and a second try works [3]", async () => {
  const world = library();
  world.failOn.add("deleteChapter");
  assertEquals((await deleteChapter(world, TOKEN_ALICE, { chapter_id: CHAPTER })).status, 500);
  assertEquals(world.chapters.has(CHAPTER), true);
  world.failOn.clear();
  assertEquals((await deleteChapter(world, TOKEN_ALICE, { chapter_id: CHAPTER })).status, 200);
});

Deno.test("move-page moves a page to another notebook and chapter, and changes no text [5]", async () => {
  const world = library();
  const response = await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK, chapter_id: SECOND_CHAPTER });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { moved: true });
  assertEquals(world.page(PAGE_ID).notebookId, SECOND_NOTEBOOK);
  assertEquals(world.page(PAGE_ID).chapterId, SECOND_CHAPTER);
  assertEquals(world.pageTexts.get(PAGE_ID)?.text, "text");
  assertEquals(world.photos.size, 4);
  assertEquals(world.calls.filter((name) => name.startsWith("removePageFiles")), []);
});

Deno.test("move-page moves a page out of its chapter, and into a notebook with no chapter [5]", async () => {
  const world = library();
  assertEquals((await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: NOTEBOOK, chapter_id: null })).status, 200);
  assertEquals(world.page(PAGE_ID).chapterId, null);
  assertEquals(world.page(PAGE_ID).notebookId, NOTEBOOK);
  assertEquals((await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK, chapter_id: null })).status, 200);
  assertEquals(world.page(PAGE_ID).notebookId, SECOND_NOTEBOOK);
});

Deno.test("move-page says so when the page is already there [5]", async () => {
  const world = library();
  const response = await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: NOTEBOOK, chapter_id: CHAPTER });
  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { moved: false });
});

Deno.test("move-page refuses a chapter of another notebook than the target notebook [5]", async () => {
  const world = library();
  const before = stateOf(world);
  const response = await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: NOTEBOOK, chapter_id: SECOND_CHAPTER });
  assertEquals(response.status, 404);
  assertEquals(await readJson(response), { error: "chapter_not_found" });
  assertEquals(stateOf(world), before);
});

Deno.test("move-page refuses the page, the notebook or the chapter of another account, and a page or a notebook that does not exist [6]", async () => {
  const cases = [
    { body: { page_id: OTHER_PAGE_ID, notebook_id: NOTEBOOK, chapter_id: null }, error: "page_not_found" },
    { body: { page_id: UNKNOWN, notebook_id: NOTEBOOK, chapter_id: null }, error: "page_not_found" },
    { body: { page_id: PAGE_ID, notebook_id: BOB_NOTEBOOK, chapter_id: null }, error: "notebook_not_found" },
    { body: { page_id: PAGE_ID, notebook_id: UNKNOWN, chapter_id: null }, error: "notebook_not_found" },
    { body: { page_id: PAGE_ID, notebook_id: BOB_NOTEBOOK, chapter_id: BOB_CHAPTER }, error: "notebook_not_found" },
    { body: { page_id: PAGE_ID, notebook_id: NOTEBOOK, chapter_id: BOB_CHAPTER }, error: "chapter_not_found" },
    { body: { page_id: PAGE_ID, notebook_id: NOTEBOOK, chapter_id: UNKNOWN }, error: "chapter_not_found" },
  ];
  for (const { body, error } of cases) {
    const world = library();
    const before = stateOf(world);
    const response = await movePage(world, TOKEN_ALICE, body);
    assertEquals(response.status, 404);
    assertEquals(await readJson(response), { error });
    assertEquals(stateOf(world), before);
  }
});

Deno.test("move-page refuses a page being read [6]", async () => {
  const world = library();
  world.page(PAGE_ID).status = "processing";
  const before = stateOf(world);
  const response = await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK, chapter_id: null });
  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "page_processing" });
  assertEquals(stateOf(world), before);
});

Deno.test("move-page needs the three fields, the chapter being null when there is none [5]", async () => {
  const world = library();
  const before = stateOf(world);
  for (const body of [{ page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK }, { page_id: PAGE_ID, chapter_id: null }, { notebook_id: SECOND_NOTEBOOK, chapter_id: null }]) {
    assertEquals((await movePage(world, TOKEN_ALICE, body)).status, 400);
  }
  assertEquals(stateOf(world), before);
});

Deno.test("move-page logs the page and nothing else [5]", async () => {
  const world = library();
  await movePage(world, TOKEN_ALICE, { page_id: PAGE_ID, notebook_id: SECOND_NOTEBOOK, chapter_id: null });
  assertEquals(world.logs, [{ event: "page_moved", fields: { pageId: PAGE_ID } }]);
});

Deno.test("an account never reaches another account's library through any of the four functions [6]", async () => {
  const world = library();
  const before = stateOf(world);
  await deletePage(world, TOKEN_BOB, { page_id: PAGE_ID });
  await deleteNotebook(world, TOKEN_BOB, { notebook_id: NOTEBOOK });
  await deleteChapter(world, TOKEN_BOB, { chapter_id: CHAPTER });
  await movePage(world, TOKEN_BOB, { page_id: PAGE_ID, notebook_id: BOB_NOTEBOOK, chapter_id: null });
  assertEquals(stateOf(world), before);
  assert(world.calls.every((name) => !name.startsWith("removePageFiles")));
});
