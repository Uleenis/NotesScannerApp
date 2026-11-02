import { callPrepare, callRead, insertPage, markUploaded, uploadPhoto } from "@/capture/api";
import { realQueueDeps } from "@/capture/queue-service";
import { announceQueue, subscribeQueue } from "@/offline/queue-state";
import type { QueuedPage } from "@/offline/queue";

import { uuid } from "./offline-fixtures";

jest.mock("expo-file-system", () => jest.requireActual("./fake-offline").fileSystem);
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
jest.mock("@/capture/api", () => ({
  insertPage: jest.fn(),
  callPrepare: jest.fn(),
  callRead: jest.fn(),
  markUploaded: jest.fn(),
  uploadPhoto: jest.fn(),
}));

const PAGE = uuid(900);

function entry(extra: Partial<QueuedPage> = {}): QueuedPage {
  return { id: uuid(1), notebookId: uuid(101), chapterId: uuid(201), source: "import", capturedAt: "2026-11-02T09:00:00.000Z", pageId: null, blocked: null, ...extra };
}

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

beforeEach(() => {
  jest.mocked(insertPage).mockReset().mockResolvedValue({ status: "created", pageId: PAGE });
  jest.mocked(callPrepare).mockReset().mockResolvedValue({ status: "ready", path: "u/p/original.jpg", token: "t" });
  jest.mocked(uploadPhoto).mockReset().mockResolvedValue("uploaded");
  jest.mocked(markUploaded).mockReset().mockResolvedValue("marked");
  jest.mocked(callRead).mockReset().mockResolvedValue(undefined);
});

describe("sending a waiting page to the server", () => {
  it("creates the page with the moment of the capture, keeps its id at once, then prepares, uploads the bytes, marks it and starts the reading", async () => {
    const order: string[] = [];
    jest.mocked(insertPage).mockImplementation(async () => {
      order.push("create");
      return { status: "created", pageId: PAGE };
    });
    jest.mocked(callPrepare).mockImplementation(async () => {
      order.push("prepare");
      return { status: "ready", path: "u/p/original.jpg", token: "t" };
    });
    const created = jest.fn(async () => {
      order.push("kept");
    });
    const result = await realQueueDeps().send({ entry: entry(), bytes, chapterId: uuid(201), capturedAt: "2026-11-02T08:30:00.000Z", onCreated: created });

    expect(result).toEqual({ status: "sent", pageId: PAGE });
    expect(insertPage).toHaveBeenCalledWith(expect.anything(), uuid(101), "2026-11-02T08:30:00.000Z", uuid(201), "import");
    expect(created).toHaveBeenCalledWith(PAGE);
    expect(order).toEqual(["create", "kept", "prepare"]);
    expect(uploadPhoto).toHaveBeenCalledWith(expect.anything(), "u/p/original.jpg", "t", bytes);
    expect(markUploaded).toHaveBeenCalledWith(expect.anything(), PAGE, expect.any(String));
    expect(callRead).toHaveBeenCalledWith(expect.anything(), PAGE);
  });

  it("takes up the page already made by the server without creating another one [10]", async () => {
    const created = jest.fn();
    const result = await realQueueDeps().send({ entry: entry({ pageId: PAGE }), bytes, chapterId: uuid(201), capturedAt: "2026-11-02T08:30:00.000Z", onCreated: created });

    expect(result).toEqual({ status: "sent", pageId: PAGE });
    expect(insertPage).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(callPrepare).toHaveBeenCalledWith(expect.anything(), PAGE);
  });

  it("does not upload again a page whose photo the server already holds", async () => {
    jest.mocked(callPrepare).mockResolvedValue({ status: "exists" });
    const result = await realQueueDeps().send({ entry: entry({ pageId: PAGE }), bytes, chapterId: null, capturedAt: "2026-11-02T08:30:00.000Z", onCreated: jest.fn() });

    expect(result).toEqual({ status: "sent", pageId: PAGE });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("fails when the id of the new page cannot be kept", async () => {
    const result = await realQueueDeps().send({
      entry: entry(),
      bytes,
      chapterId: null,
      capturedAt: "2026-11-02T08:30:00.000Z",
      onCreated: async () => {
        throw new Error("store_closed");
      },
    });

    expect(result.status).toBe("failed");
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("passes on a refusal of the limit with the page and the reason", async () => {
    jest.mocked(callPrepare).mockResolvedValue({ status: "limit", reason: "anonymous_daily_cap" });
    const result = await realQueueDeps().send({ entry: entry(), bytes, chapterId: null, capturedAt: "2026-11-02T08:30:00.000Z", onCreated: jest.fn() });

    expect(result).toEqual({ status: "limit", reason: "anonymous_daily_cap", pageId: PAGE });
  });

  it("reports a photo the server refuses and one that is too heavy", async () => {
    jest.mocked(uploadPhoto).mockResolvedValueOnce("refused").mockResolvedValueOnce("tooLarge");
    const send = () => realQueueDeps().send({ entry: entry(), bytes, chapterId: null, capturedAt: "2026-11-02T08:30:00.000Z", onCreated: jest.fn() });

    expect((await send()).status).toBe("photo");
    expect((await send()).status).toBe("tooLarge");
  });

  it("tells the screens again when the reading has answered", async () => {
    const heard = jest.fn();
    const stop = subscribeQueue(heard);
    await realQueueDeps().send({ entry: entry(), bytes, chapterId: null, capturedAt: "2026-11-02T08:30:00.000Z", onCreated: jest.fn() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    stop();
    announceQueue();

    expect(heard).toHaveBeenCalledTimes(1);
  });
});
