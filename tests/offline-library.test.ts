import {
  dropNotebook,
  dropPage,
  putAlerts,
  putChapter,
  putNotebook,
  putPage,
  putRendering,
  readAlerts,
  readLibrary,
  readRendering,
  replaceChapters,
  replaceNotebooks,
  replacePages,
} from "@/offline/library";
import { keepPhoto, hasPhoto } from "@/offline/page-photos";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";
import { numberPages } from "@/pages/pages";

import { fakeFiles, resetOffline } from "./fake-offline";
import { OTHER_USER, USER, chapter, jpeg, notebook, page } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

let store: AccountStore;

beforeEach(async () => {
  resetOffline();
  store = (await openAccountStore(USER)).store;
});

afterEach(async () => {
  await closeAccountStores();
});

function photoFiles(): number {
  return [...fakeFiles.keys()].filter((uri) => uri.includes("/pages/") && uri.endsWith(".bin")).length;
}

describe("filling from the server", () => {
  it("makes the database equal to what the server returned", async () => {
    const notebooks = [notebook(1), notebook(2)];
    const chapters = [chapter(1, 1), chapter(2, 2)];
    const pages = [page(1, 1, { chapterId: chapter(1, 1).id }), page(2, 1), page(3, 2, { text: null, status: "queued" })];
    await replaceNotebooks(store, notebooks);
    await replaceChapters(store, chapters);
    await replacePages(store, pages);
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual(notebooks);
    expect(library.chapters).toEqual(chapters);
    expect(library.pages).toEqual(pages);
  });

  it("keeps the text of a page and nothing numbered", async () => {
    const numbered = numberPages([page(1, 1), page(2, 1)]);
    await replacePages(store, numbered);
    const { pages } = await readLibrary(store);
    expect(pages.map((stored) => stored.text)).toEqual(["Text of page 1", "Text of page 2"]);
    expect(pages.every((stored) => !("number" in stored))).toBe(true);
  });

  it("replaces what the database kept for an object the server returns again", async () => {
    await replacePages(store, [page(1, 1, { text: "old", status: "processing" })]);
    await replacePages(store, [page(1, 1, { text: "new", status: "read" })]);
    const { pages } = await readLibrary(store);
    expect(pages).toEqual([page(1, 1, { text: "new", status: "read" })]);
  });

  it("removes a notebook, a chapter and a page the server no longer has", async () => {
    await replaceNotebooks(store, [notebook(1), notebook(2)]);
    await replaceChapters(store, [chapter(1, 1), chapter(2, 1)]);
    await replacePages(store, [page(1, 1), page(2, 1), page(3, 2)]);
    await replaceNotebooks(store, [notebook(1)]);
    await replaceChapters(store, [chapter(1, 1)]);
    await replacePages(store, [page(1, 1)]);
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual([notebook(1)]);
    expect(library.chapters).toEqual([chapter(1, 1)]);
    expect(library.pages).toEqual([page(1, 1)]);
  });

  it("removes the photo, the alerts and the rendering of a page the server no longer has", async () => {
    await replacePages(store, [page(1, 1), page(2, 1)]);
    for (const n of [1, 2]) {
      await keepPhoto(store, page(n, 1).id, jpeg(1024, n));
      await putAlerts(store, page(n, 1).id, ["missing_line"]);
      await putRendering(store, page(n, 1).id, { text: "rich", basedOn: "abc" });
    }
    expect(photoFiles()).toBe(2);
    await replacePages(store, [page(1, 1)]);
    expect(photoFiles()).toBe(1);
    expect(await hasPhoto(store, page(2, 1).id)).toBe(false);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
    expect(await readAlerts(store, page(2, 1).id)).toBeNull();
    expect(await readRendering(store, page(2, 1).id)).toBeNull();
    expect(await readAlerts(store, page(1, 1).id)).toEqual(["missing_line"]);
    expect(await readRendering(store, page(1, 1).id)).toEqual({ text: "rich", basedOn: "abc" });
  });

  it("removes a photo that belongs to no page of the list", async () => {
    await keepPhoto(store, page(9, 1).id, jpeg(1024));
    await replacePages(store, [page(1, 1)]);
    expect(await hasPhoto(store, page(9, 1).id)).toBe(false);
    expect(photoFiles()).toBe(0);
  });

  it("removes the chapters, the pages and the photos of a notebook the server no longer has", async () => {
    await replaceNotebooks(store, [notebook(1), notebook(2)]);
    await replaceChapters(store, [chapter(1, 1), chapter(2, 2)]);
    await replacePages(store, [page(1, 1), page(2, 2)]);
    await keepPhoto(store, page(1, 1).id, jpeg(1024, 1));
    await keepPhoto(store, page(2, 2).id, jpeg(1024, 2));
    await replaceNotebooks(store, [notebook(2)]);
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual([notebook(2)]);
    expect(library.chapters).toEqual([chapter(2, 2)]);
    expect(library.pages).toEqual([page(2, 2)]);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
    expect(await hasPhoto(store, page(2, 2).id)).toBe(true);
    expect(photoFiles()).toBe(1);
  });

  it("empties the database when the server returns nothing", async () => {
    await replaceNotebooks(store, [notebook(1)]);
    await replaceChapters(store, [chapter(1, 1)]);
    await replacePages(store, [page(1, 1)]);
    await replacePages(store, []);
    await replaceChapters(store, []);
    await replaceNotebooks(store, []);
    expect(await readLibrary(store)).toEqual({ notebooks: [], chapters: [], pages: [] });
  });

  it("writes nothing when a list holds an object that cannot be stored", async () => {
    await replacePages(store, [page(1, 1)]);
    const broken = { ...page(2, 1), id: "not-an-id" };
    await expect(replacePages(store, [page(3, 1), broken])).rejects.toThrow();
    expect((await readLibrary(store)).pages).toEqual([page(1, 1)]);
  });

  it("handles a library of thousands of pages", async () => {
    const pages = Array.from({ length: 3000 }, (_, n) => page(n + 1, 1));
    await replacePages(store, pages);
    expect((await readLibrary(store)).pages).toHaveLength(3000);
    await replacePages(store, pages.slice(0, 10));
    expect((await readLibrary(store)).pages).toHaveLength(10);
  });
});

describe("one object at a time", () => {
  it("stores a notebook, a chapter and a page, and replaces them", async () => {
    await putNotebook(store, notebook(1, "First"));
    await putNotebook(store, notebook(1, "Renamed"));
    await putChapter(store, chapter(1, 1));
    await putPage(store, page(1, 1, { text: "one" }));
    await putPage(store, page(1, 1, { text: "two" }));
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual([notebook(1, "Renamed")]);
    expect(library.chapters).toEqual([chapter(1, 1)]);
    expect(library.pages).toEqual([page(1, 1, { text: "two" })]);
  });

  it("removes a page the server says is gone, with its photo", async () => {
    await putPage(store, page(1, 1));
    await keepPhoto(store, page(1, 1).id, jpeg(1024));
    await dropPage(store, page(1, 1).id);
    expect((await readLibrary(store)).pages).toEqual([]);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
    expect(photoFiles()).toBe(0);
  });

  it("removes a notebook the server says is gone, with its chapters, pages and photos", async () => {
    await putNotebook(store, notebook(1));
    await putChapter(store, chapter(1, 1));
    await putPage(store, page(1, 1));
    await putPage(store, page(2, 2));
    await keepPhoto(store, page(1, 1).id, jpeg(1024));
    await dropNotebook(store, notebook(1).id);
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual([]);
    expect(library.chapters).toEqual([]);
    expect(library.pages).toEqual([page(2, 2)]);
    expect(photoFiles()).toBe(0);
  });

  it("refuses an identifier that is not a UUID", async () => {
    await expect(dropPage(store, "x'; drop table pages; --")).rejects.toThrow("invalid_id");
    await expect(dropNotebook(store, "nope")).rejects.toThrow("invalid_id");
  });
});

describe("what is read back", () => {
  it("skips a row that no longer reads as an object of the app", async () => {
    await putPage(store, page(1, 1));
    await store.database.runAsync("insert into pages (id, notebook_id, chapter_id, data) values (?, ?, null, ?)", [
      page(2, 1).id,
      page(2, 1).notebookId,
      "{not json",
    ]);
    await store.database.runAsync("insert into pages (id, notebook_id, chapter_id, data) values (?, ?, null, ?)", [
      page(3, 1).id,
      page(3, 1).notebookId,
      JSON.stringify({ id: page(3, 1).id, status: "unknown" }),
    ]);
    expect((await readLibrary(store)).pages).toEqual([page(1, 1)]);
  });

  it("gives alerts only from the allow-list and renderings only as text", async () => {
    await putAlerts(store, page(1, 1).id, ["missing_line", "date_incoherent"]);
    await store.database.runAsync("insert into page_alerts (page_id, data) values (?, ?)", [page(2, 1).id, JSON.stringify(["missing_line", "<script>"])]);
    await store.database.runAsync("insert into page_renderings (page_id, data) values (?, ?)", [page(2, 1).id, JSON.stringify({ text: 5, basedOn: "x" })]);
    expect(await readAlerts(store, page(1, 1).id)).toEqual(["missing_line", "date_incoherent"]);
    expect(await readAlerts(store, page(2, 1).id)).toEqual(["missing_line"]);
    expect(await readRendering(store, page(2, 1).id)).toBeNull();
  });

  it("keeps the data of one account out of the store of another", async () => {
    await putPage(store, page(1, 1));
    const other = (await openAccountStore(OTHER_USER)).store;
    expect((await readLibrary(other)).pages).toEqual([]);
    expect((await readLibrary(store)).pages).toEqual([page(1, 1)]);
  });

  it("refuses to write once the store is closed", async () => {
    await store.close();
    await expect(putPage(store, page(1, 1))).rejects.toThrow();
  });
});
