import type { SendResult } from "@/capture/send-page";
import { hasPhoto, openPhoto } from "@/offline/page-photos";
import { setMirrorIdentity } from "@/offline/mirror";
import { enqueuePage, readQueue, readQueued, removeQueued, updateQueued } from "@/offline/queue";
import { sendQueue, type QueueSendDeps } from "@/offline/queue-send";
import { dismissNotices, getNotices } from "@/offline/queue-state";
import { closeAccountStores, openAccountStore, type AccountStore } from "@/offline/store";

import { fakeFiles, resetOffline } from "./fake-offline";
import { OTHER_USER, USER, jpeg, uuid } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("expo-sqlite", () => jest.requireActual("./fake-offline").sqlite);
jest.mock("expo-crypto", () => jest.requireActual("./fake-offline").crypto);
jest.mock("expo-secure-store", () => jest.requireActual("./fake-offline").secureStore);
jest.mock("../modules/backup-exclusion", () => ({ backupExclusion: () => ({ exclude: () => true }) }));

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const NOTEBOOK = uuid(101);
const CHAPTER = uuid(201);

let store: AccountStore;

beforeEach(async () => {
  resetOffline();
  dismissNotices();
  store = (await openAccountStore(USER)).store;
});

afterEach(async () => {
  await closeAccountStores();
});

function queueFiles(): string[] {
  return [...fakeFiles.keys()].filter((uri) => uri.includes("/queue/") && uri.endsWith(".bin"));
}

async function add(seed: number, extra: Partial<{ notebookId: string; chapterId: string | null; capturedAt: string }> = {}): Promise<string> {
  return enqueuePage(
    store,
    { notebookId: NOTEBOOK, chapterId: null, source: "camera", capturedAt: `2026-11-02T0${seed}:00:00.000Z`, ...extra },
    jpeg(2000, seed),
  );
}

type Sent = { id: string; pageId: string | null; capturedAt: string; chapterId: string | null; bytes: number };

function setup(change: Partial<QueueSendDeps> = {}, answers: Record<string, SendResult> = {}) {
  const sent: Sent[] = [];
  const refreshed: string[] = [];
  let running = 0;
  let overlap = 0;
  const deps: QueueSendDeps = {
    now: () => NOW,
    targets: async (_notebookId, chapterId) => ({ status: "ok", chapterId }),
    send: async ({ entry, bytes, chapterId, capturedAt, onCreated }) => {
      running += 1;
      overlap = Math.max(overlap, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const pageId = entry.pageId ?? uuid(900 + sent.length);
      if (entry.pageId === null) {
        await onCreated(pageId);
      }
      sent.push({ id: entry.id, pageId: entry.pageId, capturedAt, chapterId, bytes: bytes.length });
      running -= 1;
      return answers[entry.id] ?? { status: "sent", pageId };
    },
    refresh: (pageId) => {
      refreshed.push(pageId);
    },
    ...change,
  };
  return { deps, sent, refreshed, overlap: () => overlap };
}

describe("sending the queue", () => {
  it("sends the pages in the order they were taken, one at a time", async () => {
    const first = await add(1);
    const second = await add(2);
    const third = await add(3);
    const run = setup();
    const result = await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.id)).toEqual([first, second, third]);
    expect(run.overlap()).toBe(1);
    expect(result).toEqual({ sent: 3, rejected: 0, stop: null });
  });

  it("sends the moment of the capture, bounded by the moment of the sending", async () => {
    await add(1, { capturedAt: "2026-11-02T09:00:00.000Z" });
    await add(2, { capturedAt: "2030-01-01T00:00:00.000Z" });
    await add(3, { capturedAt: "not a date" });
    const run = setup();
    await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.capturedAt)).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
    ]);
  });

  it("makes the sent page leave the queue and keeps its photo without a download", async () => {
    const id = await add(1);
    const run = setup();
    await sendQueue(store, run.deps);
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
    expect(await hasPhoto(store, uuid(900))).toBe(true);
    const opened = await openPhoto(store, uuid(900));
    expect(opened.status === "ok" && Array.from(opened.bytes)).toEqual(Array.from(jpeg(2000, 1)));
    expect(run.sent[0].id).toBe(id);
    expect(run.refreshed).toEqual([uuid(900)]);
  });

  it("starts only one sending when two triggers come together", async () => {
    await add(1);
    await add(2);
    const run = setup();
    const [first, second] = await Promise.all([sendQueue(store, run.deps), sendQueue(store, run.deps)]);
    expect(run.sent).toHaveLength(2);
    expect(run.overlap()).toBe(1);
    expect(second).toBe(first);
  });

  it("sends again after a run is over", async () => {
    await add(1);
    const run = setup();
    await sendQueue(store, run.deps);
    await add(2);
    await sendQueue(store, run.deps);
    expect(run.sent).toHaveLength(2);
  });

  it("keeps the page made by the server so that an interrupted sending takes it up again", async () => {
    const id = await add(1);
    const interrupted = setup({}, { [id]: { status: "network", pageId: uuid(900) } });
    const first = await sendQueue(store, interrupted.deps);
    expect(first).toEqual({ sent: 0, rejected: 0, stop: "network" });
    expect(await readQueued(store, id)).toMatchObject({ pageId: uuid(900) });
    expect(queueFiles()).toHaveLength(1);

    const again = setup();
    await sendQueue(store, again.deps);
    expect(again.sent).toEqual([expect.objectContaining({ id, pageId: uuid(900) })]);
    expect(await readQueue(store)).toEqual([]);
  });

  it("stops at a refusal of the limit, keeps the page with its reason and does not try the next ones", async () => {
    const first = await add(1);
    const second = await add(2);
    const run = setup({}, { [first]: { status: "limit", reason: "monthly_limit", pageId: uuid(900) } });
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 0, rejected: 0, stop: "limit" });
    expect(run.sent.map((entry) => entry.id)).toEqual([first]);
    expect(await readQueued(store, first)).toMatchObject({ blocked: "monthly_limit", pageId: uuid(900) });
    expect(await readQueued(store, second)).toMatchObject({ blocked: null });
    expect(queueFiles()).toHaveLength(2);
  });

  it("tries a page refused for its limit again at the next trigger and clears the reason once it is sent", async () => {
    const id = await add(1);
    await sendQueue(store, setup({}, { [id]: { status: "limit", reason: "anonymous_daily_cap", pageId: uuid(900) } }).deps);
    const run = setup();
    const result = await sendQueue(store, run.deps);
    expect(result.sent).toBe(1);
    expect(await readQueue(store)).toEqual([]);
  });

  it("keeps a page whose notebook is gone with that reason and goes on with the others", async () => {
    const lost = await add(1, { notebookId: uuid(109) });
    const kept = await add(2);
    const run = setup({
      targets: async (notebookId, chapterId) => (notebookId === uuid(109) ? { status: "notebook" } : { status: "ok", chapterId }),
    });
    const result = await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.id)).toEqual([kept]);
    expect(result).toEqual({ sent: 1, rejected: 0, stop: null });
    expect(await readQueued(store, lost)).toMatchObject({ blocked: "notebook" });
  });

  it("sends a page whose notebook was found again after the user chose another one", async () => {
    const id = await add(1, { notebookId: uuid(109) });
    await sendQueue(store, setup({ targets: async () => ({ status: "notebook" }) }).deps);
    await updateQueued(store, id, { notebookId: NOTEBOOK, chapterId: null, blocked: null });
    const run = setup();
    await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.id)).toEqual([id]);
  });

  it("puts a page whose chapter is gone in the notebook, outside any chapter", async () => {
    await add(1, { chapterId: CHAPTER });
    const run = setup({ targets: async () => ({ status: "ok", chapterId: null }) });
    await sendQueue(store, run.deps);
    expect(run.sent[0].chapterId).toBeNull();
  });

  it("asks for the notebook and the chapter of each page", async () => {
    await add(1, { chapterId: CHAPTER });
    const asked: [string, string | null][] = [];
    await sendQueue(
      store,
      setup({
        targets: async (notebookId, chapterId) => {
          asked.push([notebookId, chapterId]);
          return { status: "ok", chapterId };
        },
      }).deps,
    );
    expect(asked).toEqual([[NOTEBOOK, CHAPTER]]);
  });

  it("stops without losing anything when the network fails while looking at the notebook", async () => {
    await add(1);
    await add(2);
    const run = setup({ targets: async () => ({ status: "network" }) });
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 0, rejected: 0, stop: "network" });
    expect(run.sent).toEqual([]);
    expect(await readQueue(store)).toHaveLength(2);
  });

  it("stops at a lost connection and keeps every page", async () => {
    const first = await add(1);
    await add(2);
    const run = setup({}, { [first]: { status: "network", pageId: null } });
    const result = await sendQueue(store, run.deps);
    expect(result.stop).toBe("network");
    expect(run.sent).toHaveLength(1);
    expect(await readQueue(store)).toHaveLength(2);
  });

  it("removes a page the server refuses as unreadable or too heavy, says so, and goes on", async () => {
    const first = await add(1);
    const second = await add(2);
    const third = await add(3);
    const run = setup(
      {},
      { [first]: { status: "photo", pageId: uuid(901) }, [second]: { status: "tooLarge", pageId: uuid(902) } },
    );
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 1, rejected: 2, stop: null });
    expect(await readQueue(store)).toEqual([]);
    expect(queueFiles()).toEqual([]);
    expect(run.sent.map((entry) => entry.id)).toEqual([first, second, third]);
    expect(getNotices().rejected).toBe(2);
  });

  it("goes on with the next pages after a page that failed, and keeps the failed one", async () => {
    const first = await add(1);
    const second = await add(2);
    const run = setup({}, { [first]: { status: "failed", pageId: null } });
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 1, rejected: 0, stop: null });
    expect((await readQueue(store)).map((entry) => entry.id)).toEqual([first]);
    expect(run.sent.map((entry) => entry.id)).toEqual([first, second]);
  });

  it("keeps a page whose photo cannot be opened and goes on", async () => {
    const first = await add(1);
    const second = await add(2);
    const file = queueFiles().find((uri) => uri.includes(first));
    fakeFiles.set(file as string, new Uint8Array(100));
    const run = setup();
    const result = await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.id)).toEqual([second]);
    expect(result).toEqual({ sent: 1, rejected: 0, stop: null });
    expect((await readQueue(store)).map((entry) => entry.id)).toEqual([first]);
  });

  it("removes a page whose photo file has gone and says so", async () => {
    const first = await add(1);
    const file = queueFiles().find((uri) => uri.includes(first));
    fakeFiles.delete(file as string);
    const run = setup();
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 0, rejected: 1, stop: null });
    expect(await readQueue(store)).toEqual([]);
    expect(getNotices().rejected).toBe(1);
  });

  it("does nothing on a closed store", async () => {
    await add(1);
    await closeAccountStores();
    const run = setup();
    expect(await sendQueue(store, run.deps)).toEqual({ sent: 0, rejected: 0, stop: null });
    expect(run.sent).toEqual([]);
  });

  it("does nothing on an empty queue", async () => {
    const run = setup();
    expect(await sendQueue(store, run.deps)).toEqual({ sent: 0, rejected: 0, stop: null });
  });
});

describe("sending the queue while the user acts", () => {
  it("does not send a page the user deleted after the run began", async () => {
    const first = await add(1);
    const second = await add(2);
    const run = setup({
      targets: async (_notebookId, chapterId) => {
        if (run.sent.length === 0) {
          await removeQueued(store, second);
        }
        return { status: "ok", chapterId };
      },
    });
    const result = await sendQueue(store, run.deps);
    expect(run.sent.map((entry) => entry.id)).toEqual([first]);
    expect(result).toEqual({ sent: 1, rejected: 0, stop: null });
    expect(getNotices().rejected).toBe(0);
  });

  it("stops when the store is no longer the one of the signed-in account", async () => {
    await add(1);
    await add(2);
    setMirrorIdentity(async () => OTHER_USER);
    try {
      const run = setup();
      expect(await sendQueue(store, run.deps)).toEqual({ sent: 0, rejected: 0, stop: null });
      expect(run.sent).toEqual([]);
      expect(await readQueue(store)).toHaveLength(2);
    } finally {
      setMirrorIdentity(null);
    }
  });
});

describe("a page deleted while it is being sent", () => {
  it("keeps no photo for it once the server has taken it, and counts it as sent", async () => {
    const id = await add(1);
    const run = setup({
      send: async ({ entry }) => {
        await removeQueued(store, entry.id);
        return { status: "sent", pageId: uuid(950) };
      },
    });
    const result = await sendQueue(store, run.deps);
    expect(result).toEqual({ sent: 1, rejected: 0, stop: null });
    expect(await hasPhoto(store, uuid(950))).toBe(false);
    expect(await readQueued(store, id)).toBeNull();
  });
});
