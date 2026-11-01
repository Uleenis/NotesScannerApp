import { readLibrary, replacePages } from "@/offline/library";
import { PHOTO_TARGET_BYTES, hasPhoto, keepPhoto, openPhoto } from "@/offline/page-photos";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";
import { SYNC_TIMEOUT_MS, syncStore, type SyncDeps } from "@/offline/sync";

import { resetOffline } from "./fake-offline";
import { USER, chapter, jpeg, notebook, page } from "./offline-fixtures";

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

const PAGES = [
  page(1, 1, { capturedAt: "2026-10-01T10:00:00.000Z" }),
  page(2, 1, { capturedAt: "2026-10-04T10:00:00.000Z" }),
  page(3, 1, { capturedAt: "2026-10-03T10:00:00.000Z" }),
  page(4, 1, { capturedAt: "2026-10-02T10:00:00.000Z" }),
];

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    notebooks: async () => [notebook(1)],
    chapters: async () => [chapter(1, 1)],
    pages: async () => PAGES,
    fetchPhoto: async (pageId) => {
      fetched.push(pageId);
      return { status: "ok", bytes: jpeg(2000, fetched.length) };
    },
    canDownload: () => true,
    ...overrides,
  };
}

describe("filling the database", () => {
  it("makes the database equal to what the server returns", async () => {
    await syncStore(store, deps({ canDownload: () => false }));
    expect(await readLibrary(store)).toEqual({ notebooks: [notebook(1)], chapters: [chapter(1, 1)], pages: PAGES });
  });

  it("removes what the server no longer has", async () => {
    await replacePages(store, [...PAGES, page(5, 2)]);
    await keepPhoto(store, page(5, 2).id, jpeg(1500));
    await syncStore(store, deps({ canDownload: () => false }));
    expect((await readLibrary(store)).pages).toEqual(PAGES);
    expect(await hasPhoto(store, page(5, 2).id)).toBe(false);
  });

  it("changes nothing when one of the three loads fails", async () => {
    await replacePages(store, [page(9, 1)]);
    await keepPhoto(store, page(9, 1).id, jpeg(1500));
    const used = deps({
      chapters: async () => {
        throw new Error("The chapters could not be loaded.");
      },
    });
    const report = await syncStore(store, used);
    expect(report).toEqual({ status: "failed", downloaded: 0 });
    expect((await readLibrary(store)).pages).toEqual([page(9, 1)]);
    expect(await hasPhoto(store, page(9, 1).id)).toBe(true);
    expect(used.fetched).toEqual([]);
  });
});

describe("downloading the photos", () => {
  it("downloads the photos that are missing, the most recent first, one at a time", async () => {
    let running = 0;
    let most = 0;
    const used = deps({
      fetchPhoto: async (pageId) => {
        running += 1;
        most = Math.max(most, running);
        await Promise.resolve();
        used.fetched.push(pageId);
        running -= 1;
        return { status: "ok", bytes: jpeg(2000, used.fetched.length) };
      },
    });
    const report = await syncStore(store, used);
    expect(used.fetched).toEqual([page(2, 1).id, page(3, 1).id, page(4, 1).id, page(1, 1).id]);
    expect(most).toBe(1);
    expect(report).toEqual({ status: "done", downloaded: 4 });
    for (const record of PAGES) {
      expect((await openPhoto(store, record.id)).status).toBe("ok");
    }
  });

  it("marks the most recent pages as the most recently opened, so they are the last to go", async () => {
    await syncStore(store, deps());
    const rows = await store.database.getAllAsync<{ page_id: string }>("select page_id from photos order by opened_at desc");
    expect(rows.map((row) => row.page_id)).toEqual([page(2, 1).id, page(3, 1).id, page(4, 1).id, page(1, 1).id]);
  });

  it("downloads nothing on a network billed by use", async () => {
    const used = deps({ canDownload: () => false });
    const report = await syncStore(store, used);
    expect(used.fetched).toEqual([]);
    expect(report).toEqual({ status: "done", downloaded: 0 });
  });

  it("stops as soon as the network is no longer free", async () => {
    let calls = 0;
    const used = deps({ canDownload: () => calls < 2 });
    const fetchPhoto = used.fetchPhoto;
    used.fetchPhoto = async (pageId) => {
      calls += 1;
      return fetchPhoto(pageId);
    };
    const report = await syncStore(store, used);
    expect(used.fetched).toHaveLength(2);
    expect(report.downloaded).toBe(2);
  });

  it("does not download the photo of a page sent from this phone", async () => {
    await keepPhoto(store, page(2, 1).id, jpeg(1800, 9));
    const used = deps();
    await syncStore(store, used);
    expect(used.fetched).not.toContain(page(2, 1).id);
    expect(used.fetched).toHaveLength(3);
    const sent = await openPhoto(store, page(2, 1).id);
    expect(sent.status === "ok" && sent.bytes.length).toBe(1800);
  });

  it("skips a photo the server does not have and goes on", async () => {
    const used = deps({
      fetchPhoto: async (pageId) => {
        used.fetched.push(pageId);
        return pageId === page(3, 1).id ? { status: "gone" } : { status: "ok", bytes: jpeg(2000) };
      },
    });
    const report = await syncStore(store, used);
    expect(used.fetched).toHaveLength(4);
    expect(report.downloaded).toBe(3);
    expect(await hasPhoto(store, page(3, 1).id)).toBe(false);
  });

  it("stops when the network fails and keeps what it has", async () => {
    const used = deps({
      fetchPhoto: async (pageId) => {
        used.fetched.push(pageId);
        return used.fetched.length === 2 ? { status: "network" } : { status: "ok", bytes: jpeg(2000) };
      },
    });
    const report = await syncStore(store, used);
    expect(used.fetched).toHaveLength(2);
    expect(report).toEqual({ status: "done", downloaded: 1 });
  });

  it("stops downloading once the photos reach 900 MB, and removes nothing", async () => {
    await store.database.runAsync("insert into photos (page_id, bytes, opened_at) values (?, ?, ?)", [page(1, 1).id, PHOTO_TARGET_BYTES, 1]);
    await store.pagePhotos.save(page(1, 1).id, jpeg(1000));
    const used = deps();
    await syncStore(store, used);
    expect(used.fetched).toEqual([]);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
  });

  it("does not keep a photo that is not a JPEG", async () => {
    const used = deps({ fetchPhoto: async () => ({ status: "ok", bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) }) });
    const report = await syncStore(store, used);
    expect(report.downloaded).toBe(0);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
  });

  it("stops without a word when the store is closed on the way", async () => {
    const used = deps();
    const fetchPhoto = used.fetchPhoto;
    used.fetchPhoto = async (pageId) => {
      const result = await fetchPhoto(pageId);
      await store.close();
      return result;
    };
    await expect(syncStore(store, used)).resolves.toMatchObject({ status: "done" });
    expect(used.fetched).toHaveLength(1);
  });
});

describe("one synchronisation at a time", () => {
  it("lets a new synchronisation start when the running one is stuck", async () => {
    jest.useFakeTimers();
    let loads = 0;
    const stuck = deps({
      pages: () => {
        loads += 1;
        return new Promise(() => undefined);
      },
    });
    const first = syncStore(store, stuck);
    await jest.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 1);
    await expect(first).resolves.toEqual({ status: "failed", downloaded: 0 });
    void syncStore(store, stuck);
    expect(loads).toBe(2);
    jest.useRealTimers();
  });

  it("shares a running synchronisation between two triggers", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    const used = deps({
      pages: async () => {
        loads += 1;
        await gate;
        return PAGES;
      },
      canDownload: () => false,
    });
    const first = syncStore(store, used);
    const second = syncStore(store, used);
    release();
    await Promise.all([first, second]);
    expect(loads).toBe(1);
    await syncStore(store, used);
    expect(loads).toBe(2);
  });
});
