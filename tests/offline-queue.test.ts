import { announceQueue, subscribeQueue } from "@/offline/queue-state";
import {
  QUEUE_MAX,
  enqueuePage,
  openQueuedPhoto,
  readQueue,
  readQueued,
  removeQueued,
  updateQueued,
} from "@/offline/queue";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { fakeFaults, fakeFiles, resetOffline } from "./fake-offline";
import { USER, jpeg, uuid } from "./offline-fixtures";

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

const target = { notebookId: uuid(101), chapterId: null, source: "camera" as const, capturedAt: "2026-11-02T09:00:00.000Z" };

function queueFiles(): string[] {
  return [...fakeFiles.keys()].filter((uri) => uri.includes("/queue/") && uri.endsWith(".bin"));
}

describe("the queue of waiting pages", () => {
  it("keeps a page with its notebook, chapter, source, moment and rank", async () => {
    const id = await enqueuePage(store, { ...target, chapterId: uuid(201), source: "import" }, jpeg(3000));
    expect(await readQueue(store)).toEqual([
      { id, notebookId: uuid(101), chapterId: uuid(201), source: "import", capturedAt: target.capturedAt, pageId: null, blocked: null },
    ]);
  });

  it("lists the pages in the order they were taken", async () => {
    const first = await enqueuePage(store, target, jpeg(2000, 1));
    const second = await enqueuePage(store, target, jpeg(2000, 2));
    const third = await enqueuePage(store, target, jpeg(2000, 3));
    expect((await readQueue(store)).map((entry) => entry.id)).toEqual([first, second, third]);
  });

  it("survives the closing of the app: the same pages and photos open again", async () => {
    const id = await enqueuePage(store, target, jpeg(2500, 4));
    await closeAccountStores();
    store = (await openAccountStore(USER)).store;
    expect((await readQueue(store)).map((entry) => entry.id)).toEqual([id]);
    const opened = await openQueuedPhoto(store, id);
    expect(opened.status === "ok" && Array.from(opened.bytes)).toEqual(Array.from(jpeg(2500, 4)));
  });

  it("seals the photo under the queue and writes nothing in clear", async () => {
    const bytes = jpeg(3000);
    await enqueuePage(store, target, bytes);
    expect(queueFiles()).toHaveLength(1);
    expect(fakeFiles.get(queueFiles()[0])?.slice(12, 16)).not.toEqual(bytes.slice(0, 4));
  });

  it("does not open a waiting photo as the photo of a page", async () => {
    const id = await enqueuePage(store, target, jpeg(2000));
    const sealed = fakeFiles.get(queueFiles()[0]);
    expect(sealed).toBeDefined();
    fakeFiles.set(`file:///docs/offline/${USER}/pages/${id}.bin`, sealed as Uint8Array);
    expect((await store.pagePhotos.open(id)).status).toBe("refused");
  });

  it("refuses a photo that is not a JPEG and keeps nothing", async () => {
    await expect(enqueuePage(store, target, new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow();
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
  });

  it("keeps nothing when the phone has no room left", async () => {
    fakeFaults.write = true;
    await expect(enqueuePage(store, target, jpeg(3000))).rejects.toThrow();
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
  });

  it("refuses a page beyond the bound of the queue", async () => {
    for (let index = 0; index < QUEUE_MAX; index += 1) {
      await store.database.runAsync("insert into queue (id, rank, data) values (?, ?, ?)", [uuid(1000 + index), index + 1, JSON.stringify({})]);
    }
    await expect(enqueuePage(store, target, jpeg(2000))).rejects.toThrow("queue_full");
    expect(queueFiles()).toEqual([]);
  });

  it("refuses ids and targets that are not UUIDs", async () => {
    await expect(enqueuePage(store, { ...target, notebookId: "x'; drop table queue; --" }, jpeg(2000))).rejects.toThrow();
    await expect(enqueuePage(store, { ...target, chapterId: "nope" }, jpeg(2000))).rejects.toThrow();
    await expect(enqueuePage(store, { ...target, source: "other" as "camera" }, jpeg(2000))).rejects.toThrow();
  });

  it("changes only the notebook, the chapter, the page and the reason of a page", async () => {
    const id = await enqueuePage(store, target, jpeg(2000));
    await updateQueued(store, id, { pageId: uuid(900) });
    await updateQueued(store, id, { blocked: "monthly_limit" });
    expect(await readQueued(store, id)).toMatchObject({ pageId: uuid(900), blocked: "monthly_limit", notebookId: uuid(101) });
    await updateQueued(store, id, { notebookId: uuid(102), chapterId: null, blocked: null });
    expect(await readQueued(store, id)).toMatchObject({ notebookId: uuid(102), blocked: null, pageId: uuid(900) });
    await expect(updateQueued(store, id, { pageId: "nope" })).rejects.toThrow();
    await expect(updateQueued(store, id, { blocked: "other" as "notebook" })).rejects.toThrow();
  });

  it("removes a page with its photo", async () => {
    const id = await enqueuePage(store, target, jpeg(2000));
    await removeQueued(store, id);
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
    expect((await openQueuedPhoto(store, id)).status).toBe("missing");
  });

  it("skips a row that does not pass the guards", async () => {
    const id = await enqueuePage(store, target, jpeg(2000));
    await store.database.runAsync("insert into queue (id, rank, data) values (?, ?, ?)", [uuid(5), 99, "{not json"]);
    await store.database.runAsync("insert into queue (id, rank, data) values (?, ?, ?)", [uuid(6), 100, JSON.stringify({ notebookId: 3 })]);
    expect((await readQueue(store)).map((entry) => entry.id)).toEqual([id]);
  });

  it("tells the screens whenever the queue changes", async () => {
    const heard = jest.fn();
    const stop = subscribeQueue(heard);
    const id = await enqueuePage(store, target, jpeg(2000));
    await updateQueued(store, id, { blocked: "notebook" });
    await removeQueued(store, id);
    expect(heard).toHaveBeenCalledTimes(3);
    announceQueue();
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
  });

  it("refuses a closed store", async () => {
    await closeAccountStores();
    await expect(enqueuePage(store, target, jpeg(2000))).rejects.toThrow("store_closed");
  });
});
