import { Alert } from "react-native";

import {
  cachedAlerts,
  cachedChapters,
  cachedNotebook,
  cachedNotebooks,
  cachedPage,
  cachedPages,
  cachedRendering,
  viaCache,
} from "@/offline/cached";
import { putAlerts, putRendering, replaceChapters, replaceNotebooks, replacePages } from "@/offline/library";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { isOnline, setOnline, whenOnline } from "@/offline/network";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { resetOffline } from "./fake-offline";
import { OTHER_USER, USER, chapter, notebook, page } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

const mockAlert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

let store: AccountStore;
let signedIn: string | null;

beforeEach(async () => {
  resetOffline();
  mockAlert.mockClear();
  signedIn = USER;
  store = (await openAccountStore(USER)).store;
  setMirrorStore(store);
  setMirrorIdentity(async () => signedIn);
  setOnline(true);
});

afterEach(async () => {
  setMirrorStore(null);
  setMirrorIdentity(null);
  setOnline(true);
  await closeAccountStores();
});

async function fill(): Promise<void> {
  await replaceNotebooks(store, [notebook(1), notebook(2)]);
  await replaceChapters(store, [chapter(1, 1)]);
  await replacePages(store, [page(2, 1), page(1, 1, { chapterId: chapter(1, 1).id }), page(3, 2)]);
}

describe("the readers of the store", () => {
  it("rebuild the lists the server returned, the pages numbered by the time they were taken", async () => {
    await fill();
    expect(await cachedNotebooks(store)).toEqual([notebook(1), notebook(2)]);
    expect(await cachedChapters(store)).toEqual([chapter(1, 1)]);
    const pages = await cachedPages(store);
    expect(pages?.map((found) => [found.id, found.number])).toEqual([
      [page(1, 1).id, 1],
      [page(2, 1).id, 2],
      [page(3, 2).id, 1],
    ]);
  });

  it("know nothing of a list the server never returned, which is not the same as an empty list", async () => {
    expect(await cachedNotebooks(store)).toBeUndefined();
    expect(await cachedChapters(store)).toBeUndefined();
    expect(await cachedPages(store)).toBeUndefined();
    await replaceNotebooks(store, []);
    await replaceChapters(store, []);
    await replacePages(store, []);
    expect(await cachedNotebooks(store)).toEqual([]);
    expect(await cachedChapters(store)).toEqual([]);
    expect(await cachedPages(store)).toEqual([]);
  });

  it("read one notebook and one page with its number, and know nothing of the others", async () => {
    await fill();
    expect(await cachedNotebook(notebook(2).id)(store)).toEqual(notebook(2));
    expect(await cachedNotebook(notebook(9).id)(store)).toBeUndefined();
    expect((await cachedPage(page(2, 1).id)(store))?.number).toBe(2);
    expect((await cachedPage(page(1, 1).id)(store))?.chapterId).toBe(chapter(1, 1).id);
    expect(await cachedPage(page(9, 1).id)(store)).toBeUndefined();
  });

  it("read the alerts and the rendering kept for a page, and say there are none otherwise", async () => {
    await fill();
    await putAlerts(store, page(1, 1).id, ["missing_line"]);
    await putRendering(store, page(1, 1).id, { text: "rich", basedOn: "abc" });
    expect(await cachedAlerts(page(1, 1).id)(store)).toEqual(["missing_line"]);
    expect(await cachedAlerts(page(2, 1).id)(store)).toEqual([]);
    expect(await cachedRendering(page(1, 1).id)(store)).toEqual({ text: "rich", basedOn: "abc" });
    expect(await cachedRendering(page(2, 1).id)(store)).toBeNull();
  });
});

describe("viaCache", () => {
  it("returns what the server returns while the network is there", async () => {
    await fill();
    const request = jest.fn(async () => [notebook(7)]);
    expect(await viaCache(request, cachedNotebooks)).toEqual([notebook(7)]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads the store and does not call the server when the network is missing", async () => {
    await fill();
    setOnline(false);
    const request = jest.fn(async () => [notebook(7)]);
    expect(await viaCache(request, cachedNotebooks)).toEqual([notebook(1), notebook(2)]);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads the store when the server cannot be reached", async () => {
    await fill();
    const request = jest.fn(async (): Promise<unknown[]> => {
      throw new Error("The notebooks could not be loaded.");
    });
    expect(await viaCache(request, cachedNotebooks)).toEqual([notebook(1), notebook(2)]);
  });

  it("fails like the server when the store knows nothing of the list", async () => {
    setOnline(false);
    const request = jest.fn(async () => [notebook(7)]);
    expect(await viaCache(request, cachedNotebooks)).toEqual([notebook(7)]);
    setOnline(true);
    await expect(
      viaCache(async (): Promise<unknown[]> => {
        throw new Error("down");
      }, cachedNotebooks),
    ).rejects.toThrow("down");
  });

  it("reads nothing from the store of an account that is no longer the signed-in one", async () => {
    await fill();
    setOnline(false);
    signedIn = OTHER_USER;
    const request = jest.fn(async () => [notebook(7)]);
    expect(await viaCache(request, cachedNotebooks)).toEqual([notebook(7)]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when no store is open", async () => {
    setMirrorStore(null);
    setOnline(false);
    expect(await viaCache(async () => ["server"], async () => ["cache"])).toEqual(["server"]);
  });

  it("reads nothing from a store that was closed", async () => {
    await fill();
    await store.close();
    setOnline(false);
    expect(await viaCache(async () => [notebook(7)], cachedNotebooks)).toEqual([notebook(7)]);
  });
});

describe("the network flag", () => {
  it("starts online, follows what it is told, and runs a gesture only with the network", () => {
    expect(isOnline()).toBe(true);
    const action = jest.fn();
    whenOnline("No connection.", action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
    setOnline(false);
    whenOnline("No connection.", action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith("No connection.");
  });
});
