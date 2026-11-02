import { checkTargets } from "@/capture/queue-service";
import { captureService } from "@/capture/service";
import { getSupabase } from "@/lib/supabase";
import { readLimit } from "@/offline/limit";
import { setMirrorIdentity, setMirrorStore } from "@/offline/mirror";
import { setOnline } from "@/offline/network";
import { enqueuePage, readQueue } from "@/offline/queue";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { fakeFiles, resetOffline } from "./fake-offline";
import { OTHER_USER, USER, jpeg, uuid } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("expo-image-manipulator", () => ({}));
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: jest.fn() }));

const NOTEBOOK = uuid(101);
const CHAPTER = uuid(201);
const PHOTO = "file:///cache/page.jpg";

let store: AccountStore;
let signedIn: string | null;
let rpc: jest.Mock;

const row = { is_anonymous: false, used: 5, max: 15, remaining: 10, resets_at: "2099-01-01T00:00:00.000Z", blocked_reason: null };

beforeEach(async () => {
  resetOffline();
  setOnline(true);
  signedIn = USER;
  rpc = jest.fn(async () => ({ data: [row], error: null }));
  jest.mocked(getSupabase).mockReturnValue({ rpc } as never);
  store = (await openAccountStore(USER)).store;
  setMirrorStore(store);
  setMirrorIdentity(async () => signedIn);
});

afterEach(async () => {
  setMirrorStore(null);
  setMirrorIdentity(null);
  setOnline(true);
  await closeAccountStores();
});

async function wait(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("the allowance without a network", () => {
  it("keeps the limit of the server each time it is read", async () => {
    const allowance = await captureService.allowance();
    await wait();
    expect(allowance).toMatchObject({ remaining: 10, max: 15 });
    expect(await readLimit(store)).toMatchObject({ allowance: { remaining: 10, used: 5, max: 15 } });
  });

  it("is computed from the store when the network is missing, without asking the server", async () => {
    await captureService.allowance();
    await wait();
    rpc.mockClear();
    setOnline(false);
    await enqueuePage(store, { notebookId: NOTEBOOK, chapterId: null, source: "camera", capturedAt: "2026-11-02T09:00:00.000Z" }, jpeg(2000));
    await enqueuePage(store, { notebookId: NOTEBOOK, chapterId: null, source: "camera", capturedAt: "2026-11-02T09:01:00.000Z" }, jpeg(2000));
    expect(await captureService.allowance()).toMatchObject({ remaining: 8, blockedReason: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("knows nothing when no limit was ever read", async () => {
    setOnline(false);
    expect(await captureService.allowance()).toBeNull();
  });

  it("knows nothing for a store that is not the signed-in account", async () => {
    await captureService.allowance();
    await wait();
    setOnline(false);
    signedIn = OTHER_USER;
    expect(await captureService.allowance()).toBeNull();
  });

  it("falls back on the store when the server cannot be reached though the flag says online", async () => {
    await captureService.allowance();
    await wait();
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    expect(await captureService.allowance()).toMatchObject({ remaining: 10 });
  });

  it("still fails when the server cannot be reached and nothing is known", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    await expect(captureService.allowance()).rejects.toThrow();
  });
});

describe("keeping a captured page in the queue", () => {
  beforeEach(() => {
    fakeFiles.set(PHOTO, jpeg(3000));
  });

  it("stores the page with its photo, its notebook, chapter, source and the moment of the capture", async () => {
    const before = Date.now();
    const result = await captureService.enqueue({ notebookId: NOTEBOOK, chapterId: CHAPTER, photoUri: PHOTO, source: "import" });
    expect(result.status).toBe("queued");
    const [entry] = await readQueue(store);
    expect(entry).toMatchObject({ notebookId: NOTEBOOK, chapterId: CHAPTER, source: "import", pageId: null, blocked: null });
    expect(Date.parse(entry.capturedAt)).toBeGreaterThanOrEqual(before);
    expect(result.status === "queued" && result.id).toBe(entry.id);
  });

  it("fails, keeping nothing, when the store is closed", async () => {
    setMirrorStore(null);
    expect(await captureService.enqueue({ notebookId: NOTEBOOK, chapterId: null, photoUri: PHOTO, source: "camera" })).toEqual({ status: "failed" });
  });

  it("fails for a store that is not the signed-in account", async () => {
    signedIn = OTHER_USER;
    expect(await captureService.enqueue({ notebookId: NOTEBOOK, chapterId: null, photoUri: PHOTO, source: "camera" })).toEqual({ status: "failed" });
    expect(await readQueue(store)).toEqual([]);
  });

  it("fails when the photo cannot be read or is not a JPEG", async () => {
    fakeFiles.delete(PHOTO);
    expect(await captureService.enqueue({ notebookId: NOTEBOOK, chapterId: null, photoUri: PHOTO, source: "camera" })).toEqual({ status: "failed" });
    fakeFiles.set(PHOTO, new Uint8Array([1, 2, 3, 4]));
    expect(await captureService.enqueue({ notebookId: NOTEBOOK, chapterId: null, photoUri: PHOTO, source: "camera" })).toEqual({ status: "failed" });
    expect(await readQueue(store)).toEqual([]);
  });
});

describe("looking for the notebook and the chapter of a waiting page", () => {
  type Table = "notebooks" | "chapters";

  function client(found: Partial<Record<Table, boolean>>, error: Partial<Record<Table, unknown>> = {}) {
    const asked: string[] = [];
    return {
      asked,
      client: {
        from: (table: Table) => {
          const query = {
            select: () => query,
            eq: (column: string, value: string) => {
              asked.push(`${table}.${column}=${value}`);
              return query;
            },
            maybeSingle: async () => ({ data: found[table] === true ? { id: "x" } : null, error: error[table] ?? null }),
          };
          return query;
        },
      },
    };
  }

  it("finds both", async () => {
    const { client: fake, asked } = client({ notebooks: true, chapters: true });
    expect(await checkTargets(fake as never, NOTEBOOK, CHAPTER)).toEqual({ status: "ok", chapterId: CHAPTER });
    expect(asked).toEqual([`notebooks.id=${NOTEBOOK}`, `chapters.id=${CHAPTER}`, `chapters.notebook_id=${NOTEBOOK}`]);
  });

  it("does not look for a chapter when the page has none", async () => {
    const { client: fake, asked } = client({ notebooks: true });
    expect(await checkTargets(fake as never, NOTEBOOK, null)).toEqual({ status: "ok", chapterId: null });
    expect(asked).toEqual([`notebooks.id=${NOTEBOOK}`]);
  });

  it("reports a notebook that is gone", async () => {
    expect(await checkTargets(client({}).client as never, NOTEBOOK, CHAPTER)).toEqual({ status: "notebook" });
  });

  it("drops a chapter that is gone and keeps the notebook", async () => {
    expect(await checkTargets(client({ notebooks: true }).client as never, NOTEBOOK, CHAPTER)).toEqual({ status: "ok", chapterId: null });
  });

  it("stops on any error, whatever the table", async () => {
    expect(await checkTargets(client({}, { notebooks: { message: "Network request failed" } }).client as never, NOTEBOOK, null)).toEqual({
      status: "network",
    });
    expect(await checkTargets(client({ notebooks: true }, { chapters: { message: "boom", code: "XX000" } }).client as never, NOTEBOOK, CHAPTER)).toEqual({
      status: "network",
    });
  });

  it("stops when the call throws", async () => {
    const throwing = {
      from: () => {
        throw new TypeError("Network request failed");
      },
    };
    expect(await checkTargets(throwing as never, NOTEBOOK, null)).toEqual({ status: "network" });
  });
});
