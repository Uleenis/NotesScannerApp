import { readAlerts, readLibrary, readRendering } from "@/offline/library";
import { beginMirror, createMirror, setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { hasPhoto, openPhoto } from "@/offline/page-photos";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";
import { numberPages } from "@/pages/pages";

import { fakeFiles, resetOffline } from "./fake-offline";
import { OTHER_USER, USER, jpeg, notebook, page } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

let store: AccountStore;

beforeEach(async () => {
  resetOffline();
  store = (await openAccountStore(USER)).store;
  setMirrorStore(store);
});

afterEach(async () => {
  setMirrorIdentity(null);
  setMirrorStore(null);
  await closeAccountStores();
});

describe("writing what the server returned", () => {
  it("writes the lists and the objects it is given", async () => {
    const mirror = beginMirror();
    await mirror.notebooks([notebook(1)]);
    await mirror.pages(numberPages([page(1, 1), page(2, 1)]));
    const numbered = { ...page(3, 1), number: 3 };
    await mirror.page(page(3, 1).id, numbered);
    await mirror.notebook(notebook(2).id, notebook(2));
    await mirror.alerts(page(1, 1).id, ["missing_line"]);
    await mirror.rendering(page(1, 1).id, { text: "rich", basedOn: "abc" });
    const library = await readLibrary(store);
    expect(library.notebooks).toEqual([notebook(1), notebook(2)]);
    expect(library.pages.map((stored) => stored.id)).toEqual([page(1, 1).id, page(2, 1).id, page(3, 1).id]);
    expect(await readAlerts(store, page(1, 1).id)).toEqual(["missing_line"]);
    expect(await readRendering(store, page(1, 1).id)).toEqual({ text: "rich", basedOn: "abc" });
  });

  it("removes an object the server says is not there", async () => {
    const mirror = beginMirror();
    await mirror.pages([page(1, 1)]);
    await mirror.notebook(notebook(1).id, notebook(1));
    await mirror.alerts(page(1, 1).id, ["missing_line"]);
    await mirror.page(page(1, 1).id, null);
    await mirror.notebook(notebook(1).id, null);
    await mirror.rendering(page(1, 1).id, null);
    expect(await readLibrary(store)).toEqual({ notebooks: [], chapters: [], pages: [] });
  });

  it("does nothing without a store", async () => {
    setMirrorStore(null);
    const mirror = beginMirror();
    await expect(mirror.pages([page(1, 1)])).resolves.toBeUndefined();
    await expect(mirror.sentPhoto(page(1, 1).id, "file:///cache/x.jpg")).resolves.toBeUndefined();
  });

  it("never throws because the cache failed", async () => {
    const mirror = beginMirror();
    await store.close();
    await expect(mirror.pages([page(1, 1)])).resolves.toBeUndefined();
    await expect(mirror.notebook("not-an-id", notebook(1))).resolves.toBeUndefined();
    await expect(mirror.alerts(page(1, 1).id, [])).resolves.toBeUndefined();
  });

  it("writes into the store that was current when the request started", async () => {
    const mirror = beginMirror();
    const other = (await openAccountStore(OTHER_USER)).store;
    setMirrorStore(other);
    await mirror.pages([page(1, 1)]);
    expect((await readLibrary(store)).pages).toHaveLength(1);
    expect((await readLibrary(other)).pages).toHaveLength(0);
  });

  it("does not let a list that started earlier overwrite a later one", async () => {
    const earlier = beginMirror();
    const later = beginMirror();
    await later.pages([page(1, 1), page(2, 1)]);
    await earlier.pages([page(1, 1)]);
    expect((await readLibrary(store)).pages).toHaveLength(2);
    await later.notebooks([notebook(1)]);
    await earlier.notebooks([]);
    expect((await readLibrary(store)).notebooks).toEqual([notebook(1)]);
  });

  it("writes nothing when another account has signed in since the request started", async () => {
    const mirror = beginMirror();
    setMirrorIdentity(async () => OTHER_USER);
    await mirror.pages([page(1, 1)]);
    await mirror.notebook(notebook(1).id, notebook(1));
    await mirror.sentPhoto(page(1, 1).id, "file:///cache/x.jpg");
    await mirror.openedPhoto(page(1, 1).id, async () => ({ status: "ok", bytes: jpeg(2000) }));
    setMirrorIdentity(async () => null);
    await mirror.alerts(page(1, 1).id, ["missing_line"]);
    expect(await readLibrary(store)).toEqual({ notebooks: [], chapters: [], pages: [] });
    expect(await readAlerts(store, page(1, 1).id)).toBeNull();
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
  });

  it("writes when the account that is signed in is the one of the store", async () => {
    setMirrorIdentity(async () => USER);
    await beginMirror().pages([page(1, 1)]);
    expect((await readLibrary(store)).pages).toHaveLength(1);
  });

  it("can be made for a given store", async () => {
    const mirror = createMirror(store);
    await mirror.pages([page(1, 1)]);
    expect((await readLibrary(store)).pages).toHaveLength(1);
  });
});

describe("the photo of a page sent from this phone", () => {
  it("is kept sealed without any download", async () => {
    const uri = "file:///cache/prepared.jpg";
    fakeFiles.set(uri, jpeg(4000, 3));
    await beginMirror().sentPhoto(page(1, 1).id, uri);
    const opened = await openPhoto(store, page(1, 1).id);
    expect(opened.status).toBe("ok");
    expect(opened.status === "ok" && Array.from(opened.bytes)).toEqual(Array.from(jpeg(4000, 3)));
  });

  it("is left out quietly when the file cannot be read", async () => {
    await expect(beginMirror().sentPhoto(page(1, 1).id, "file:///cache/missing.jpg")).resolves.toBeUndefined();
    expect(await hasPhoto(store, page(1, 1).id)).toBe(false);
  });
});

describe("the photo of a page opened online", () => {
  it("is downloaded once, whatever the network, and kept", async () => {
    const load = jest.fn(async () => ({ status: "ok" as const, bytes: jpeg(3000) }));
    await Promise.all([beginMirror().openedPhoto(page(1, 1).id, load), beginMirror().openedPhoto(page(1, 1).id, load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await hasPhoto(store, page(1, 1).id)).toBe(true);
  });

  it("is only marked as opened when it is already kept", async () => {
    const load = jest.fn(async () => ({ status: "ok" as const, bytes: jpeg(3000) }));
    await beginMirror().openedPhoto(page(1, 1).id, load);
    await beginMirror().openedPhoto(page(1, 1).id, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing when the download fails or is not a photo", async () => {
    await beginMirror().openedPhoto(page(1, 1).id, async () => ({ status: "network" }));
    await beginMirror().openedPhoto(page(2, 1).id, async () => ({ status: "gone" }));
    await beginMirror().openedPhoto(page(3, 1).id, async () => ({ status: "ok", bytes: new Uint8Array([1, 2, 3]) }));
    await beginMirror().openedPhoto(page(4, 1).id, async () => {
      throw new Error("boom");
    });
    for (const n of [1, 2, 3, 4]) {
      expect(await hasPhoto(store, page(n, 1).id)).toBe(false);
    }
  });
});
