import { openLocalPhoto } from "@/offline/local-photo";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { keepPhoto } from "@/offline/page-photos";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { fakeFiles, resetOffline } from "./fake-offline";
import { OTHER_USER, USER, jpeg, page } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

let store: AccountStore;
let signedIn: string | null;

const viewFiles = () => [...fakeFiles.keys()].filter((uri) => uri.includes("offline-view"));

beforeEach(async () => {
  resetOffline();
  signedIn = USER;
  store = (await openAccountStore(USER)).store;
  setMirrorStore(store);
  setMirrorIdentity(async () => signedIn);
});

afterEach(async () => {
  setMirrorStore(null);
  setMirrorIdentity(null);
  await closeAccountStores();
});

describe("the photo of a page kept on the phone", () => {
  it("is decrypted into a file of its own for the display and erased when the display is done", async () => {
    const bytes = jpeg(2048, 3);
    await keepPhoto(store, page(1, 1).id, bytes);
    const opened = await openLocalPhoto(page(1, 1).id);
    expect(viewFiles()).toHaveLength(1);
    expect(opened.uri).toContain("offline-view");
    expect(fakeFiles.get(viewFiles()[0])).toEqual(bytes);
    opened.release();
    expect(viewFiles()).toHaveLength(0);
  });

  it("gives each display a file of its own", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg());
    const first = await openLocalPhoto(page(1, 1).id);
    const second = await openLocalPhoto(page(1, 1).id);
    expect(first.uri).not.toBe(second.uri);
    first.release();
    expect(viewFiles()).toHaveLength(1);
    second.release();
    expect(viewFiles()).toHaveLength(0);
  });

  it("is refused when the photo is not kept, and writes nothing", async () => {
    await expect(openLocalPhoto(page(1, 1).id)).rejects.toThrow("photo_unavailable");
    expect(viewFiles()).toHaveLength(0);
  });

  it("is refused when the photo was changed by a byte, and writes nothing", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg());
    const sealed = [...fakeFiles.keys()].find((uri) => uri.endsWith(`${page(1, 1).id}.bin`));
    expect(sealed).toBeDefined();
    const changed = new Uint8Array(fakeFiles.get(sealed ?? "") ?? new Uint8Array(0));
    changed[changed.length - 1] ^= 1;
    fakeFiles.set(sealed ?? "", changed);
    await expect(openLocalPhoto(page(1, 1).id)).rejects.toThrow("photo_unavailable");
    expect(viewFiles()).toHaveLength(0);
  });

  it("is refused when no store is open, when the store is closed or when another account is signed in", async () => {
    await keepPhoto(store, page(1, 1).id, jpeg());
    signedIn = OTHER_USER;
    await expect(openLocalPhoto(page(1, 1).id)).rejects.toThrow("photo_unavailable");
    signedIn = USER;
    await store.close();
    await expect(openLocalPhoto(page(1, 1).id)).rejects.toThrow("photo_unavailable");
    setMirrorStore(null);
    await expect(openLocalPhoto(page(1, 1).id)).rejects.toThrow("photo_unavailable");
    expect(viewFiles()).toHaveLength(0);
  });
});
