import { SEAL_BYTES } from "@/offline/cipher";
import { replacePages } from "@/offline/library";
import {
  PHOTO_BUDGET_BYTES,
  PHOTO_TARGET_BYTES,
  dropPhotos,
  hasPhoto,
  keepPhoto,
  openPhoto,
  photoBytes,
  photosToFetch,
  reconcilePhotos,
  touchPhoto,
} from "@/offline/page-photos";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { fakeFiles, resetOffline } from "./fake-offline";
import { USER, jpeg, page, uuid } from "./offline-fixtures";

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

function files(kind: "pages" | "queue"): string[] {
  return [...fakeFiles.keys()].filter((uri) => uri.includes(`/${kind}/`) && uri.endsWith(".bin"));
}

describe("keeping a photo", () => {
  it("seals the photo and indexes its size", async () => {
    const bytes = jpeg(3000);
    await keepPhoto(store, page(1, 1).id, bytes, { now: 10 });
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
    expect(await photoBytes(store)).toBe(3000 + SEAL_BYTES);
    const opened = await openPhoto(store, page(1, 1).id, { now: 20 });
    expect(opened.status).toBe("ok");
    expect(opened.status === "ok" && Array.from(opened.bytes)).toEqual(Array.from(bytes));
  });

  it("keeps nothing in clear", async () => {
    const bytes = jpeg(3000);
    await keepPhoto(store, page(1, 1).id, bytes);
    const stored = fakeFiles.get(files("pages")[0]);
    expect(stored).toBeDefined();
    expect(stored?.slice(12, 16)).not.toEqual(bytes.slice(0, 4));
  });

  it("replaces the photo of a page kept twice without counting it twice", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg(3000));
    await keepPhoto(store, page(1, 1).id, jpeg(4000, 2));
    expect(files("pages")).toHaveLength(1);
    expect(await photoBytes(store)).toBe(4000 + SEAL_BYTES);
  });

  it("leaves no row and no file when the photo cannot be written", async () => {
    await expect(keepPhoto(store, page(1, 1).id, new Uint8Array(0))).rejects.toThrow();
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
    expect(files("pages")).toHaveLength(0);
  });

  it("answers missing for a page without photo and tells a row without a file", async () => {
    expect((await openPhoto(store, page(1, 1).id)).status).toBe("missing");
    await keepPhoto(store, page(1, 1).id, jpeg(2000));
    for (const uri of files("pages")) {
      fakeFiles.delete(uri);
    }
    expect((await openPhoto(store, page(1, 1).id)).status).toBe("missing");
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
  });

  it("does not open a photo changed by one byte, and keeps it for the caller to decide", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg(2000));
    const uri = files("pages")[0];
    const changed = new Uint8Array(fakeFiles.get(uri) ?? []);
    changed[20] ^= 1;
    fakeFiles.set(uri, changed);
    expect((await openPhoto(store, page(1, 1).id)).status).toBe("refused");
    expect(files("pages")).toHaveLength(1);
  });
});

describe("the budget of 1 GB", () => {
  const MB = 1024 * 1024;

  async function addRows(count: number, bytesEach: number, firstOpened = 1) {
    for (let index = 0; index < count; index += 1) {
      const id = uuid(1000 + index);
      await store.database.runAsync("insert into photos (page_id, bytes, opened_at) values (?, ?, ?)", [id, bytesEach, firstOpened + index]);
    }
  }

  it("takes the budget at 1 GB and the target at 900 MB", () => {
    expect(PHOTO_BUDGET_BYTES).toBe(1024 * MB);
    expect(PHOTO_TARGET_BYTES).toBe(900 * MB);
  });

  it("keeps everything while the photos fit", async () => {
    await addRows(10, 100 * MB);
    await keepPhoto(store, page(1, 1).id, jpeg(2000), { now: 1000 });
    expect(await photoBytes(store)).toBe(1000 * MB + 2000 + SEAL_BYTES);
  });

  it("removes the photos opened longest ago down to 900 MB, never the one just kept", async () => {
    await addRows(10, 100 * MB);
    await keepPhoto(store, page(1, 1).id, jpeg(30 * MB), { now: 1000 });
    expect(await photoBytes(store)).toBeLessThanOrEqual(PHOTO_TARGET_BYTES);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
    const left = await store.database.getAllAsync<{ page_id: string }>("select page_id from photos order by opened_at");
    expect(left.map((row) => row.page_id)[0]).toBe(uuid(1000 + 2));
  });

  it("leaves a text and a waiting page alone", async () => {
    await replacePages(store, [page(1, 1)]);
    const pendingId = uuid(7);
    await store.queuePhotos.save(pendingId, jpeg(5000));
    await addRows(10, 100 * MB);
    await keepPhoto(store, page(2, 1).id, jpeg(30 * MB), { now: 1000 });
    expect((await store.database.getFirstAsync<{ count: number }>("select count(*) as count from pages"))?.count).toBe(1);
    expect((await store.queuePhotos.open(pendingId)).status).toBe("ok");
    expect(files("queue")).toHaveLength(1);
  });

  it("removes the files of the photos it drops", async () => {
    for (let index = 0; index < 4; index += 1) {
      await keepPhoto(store, page(index + 1, 1).id, jpeg(2000, index + 1), { now: index + 1, evict: false });
    }
    expect(files("pages")).toHaveLength(4);
    await dropPhotos(store, [page(1, 1).id, page(2, 1).id]);
    expect(files("pages")).toHaveLength(2);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
    expect(await hasPhoto(store, page(3, 1).id)).toBe(true);
  });

  it("does not remove anything when asked not to", async () => {
    await addRows(11, 100 * MB);
    await keepPhoto(store, page(1, 1).id, jpeg(2000), { now: 1000, evict: false });
    expect(await photoBytes(store)).toBeGreaterThan(PHOTO_BUDGET_BYTES);
  });

  it("opens a photo and marks it as opened last", async () => {
    await addRows(10, 100 * MB);
    await keepPhoto(store, page(1, 1).id, jpeg(2000), { now: 500, evict: false });
    expect(await touchPhoto(store, uuid(1000), 900)).toBe(true);
    await keepPhoto(store, page(2, 1).id, jpeg(40 * MB), { now: 1000 });
    expect(await hasPhoto(store, uuid(1000))).toBe(true);
    expect(await hasPhoto(store, uuid(1001))).toBe(false);
  });

  it("tells when there is nothing to mark", async () => {
    expect(await touchPhoto(store, page(1, 1).id, 5)).toBe(false);
  });
});

describe("what is still to fetch", () => {
  it("lists the pages without photo, the most recent first", async () => {
    await replacePages(store, [
      page(1, 1, { capturedAt: "2026-10-01T10:00:00.000Z" }),
      page(2, 1, { capturedAt: "2026-10-03T10:00:00.000Z" }),
      page(3, 1, { capturedAt: "2026-10-02T10:00:00.000Z" }),
    ]);
    await keepPhoto(store, page(3, 1).id, jpeg(1500));
    expect(await photosToFetch(store)).toEqual([page(2, 1).id, page(1, 1).id]);
  });
});

describe("keeping the index true", () => {
  it("removes a file without a row and a row without a file", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg(2000, 1));
    await keepPhoto(store, page(2, 1).id, jpeg(2000, 2));
    await store.pagePhotos.save(page(3, 1).id, jpeg(2000, 3));
    for (const uri of files("pages")) {
      if (uri.includes(page(2, 1).id)) {
        fakeFiles.delete(uri);
      }
    }
    await reconcilePhotos(store);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
    expect(await hasPhoto(store, page(2, 1).id)).toBe(false);
    expect(files("pages")).toHaveLength(1);
    expect(await photoBytes(store)).toBe(2000 + SEAL_BYTES);
  });

  it("never touches a waiting page", async () => {
    await store.queuePhotos.save(uuid(9), jpeg(2000));
    await reconcilePhotos(store);
    expect(files("queue")).toHaveLength(1);
  });
});
