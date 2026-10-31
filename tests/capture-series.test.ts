import type { Allowance } from "@/capture/allowance";
import type { SendResult } from "@/capture/send-page";
import { destination, prepareScans, replaceAt, seriesLimit, sendSeries, type CheckedPage, type SeriesPage } from "@/capture/series";
import type { SharpnessCheck } from "@/capture/sharpness";

jest.mock("../modules/document-scanner", () => ({ documentScanner: () => null }));
jest.mock("expo-file-system", () => ({ File: class {} }));

const open: Allowance = { isAnonymous: false, used: 2, max: 15, remaining: 13, resetsAt: null, blockedReason: null };

function pages(count: number): SeriesPage[] {
  return Array.from({ length: count }, (_, index) => ({ uri: `file:///cache/page-${index + 1}.jpg`, pageId: null }));
}

describe("seriesLimit", () => {
  it("is the smaller of the pages left and 20", () => {
    expect(seriesLimit({ ...open, remaining: 13 })).toBe(13);
    expect(seriesLimit({ ...open, remaining: 2 })).toBe(2);
    expect(seriesLimit({ ...open, remaining: 400 })).toBe(20);
  });

  it("is 20 when the limits are not known: the server stays the authority", () => {
    expect(seriesLimit(null)).toBe(20);
    expect(seriesLimit(undefined)).toBe(20);
  });

  it("is never below 1, so the server can refuse a page by itself", () => {
    expect(seriesLimit({ ...open, remaining: 0 })).toBe(1);
    expect(seriesLimit({ ...open, remaining: Number.NaN })).toBe(1);
  });
});

describe("prepareScans", () => {
  function deps(overrides: Partial<Parameters<typeof prepareScans>[1]> = {}) {
    const discarded: string[] = [];
    const progress: [number, number][] = [];
    const base = {
      normalize: jest.fn(async (uri: string) => uri.replace("scans/", "ready/")),
      check: jest.fn(async (): Promise<SharpnessCheck> => "sharp"),
      discard: (uri: string) => {
        discarded.push(uri);
      },
      onProgress: (done: number, total: number) => {
        progress.push([done, total]);
      },
      ...overrides,
    };
    return { base, discarded, progress };
  }

  it("makes each scanned file a prepared one, erases the scanner's file and checks the sharpness of the prepared one", async () => {
    const { base, discarded, progress } = deps();
    const check = jest.fn(async (uri: string): Promise<SharpnessCheck> => (uri.endsWith("b.jpg") ? "blurry" : "sharp"));
    const result = await prepareScans(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"], { ...base, check });

    expect(result.pages).toEqual<CheckedPage[]>([
      { uri: "file:///cache/ready/a.jpg", sharpness: "sharp" },
      { uri: "file:///cache/ready/b.jpg", sharpness: "blurry" },
    ]);
    expect(result.unreadable).toBe(0);
    expect(check.mock.calls.map(([uri]) => uri)).toEqual(["file:///cache/ready/a.jpg", "file:///cache/ready/b.jpg"]);
    expect(discarded).toEqual(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"]);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("leaves out a page that cannot be prepared, erases its file and counts it", async () => {
    const { base, discarded } = deps({
      normalize: jest.fn(async (uri: string) => {
        if (uri.endsWith("b.jpg")) {
          throw new Error("no memory");
        }
        return uri.replace("scans/", "ready/");
      }),
    });
    const result = await prepareScans(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg", "file:///cache/scans/c.jpg"], base);

    expect(result.pages.map((page) => page.uri)).toEqual(["file:///cache/ready/a.jpg", "file:///cache/ready/c.jpg"]);
    expect(result.unreadable).toBe(1);
    expect(discarded).toContain("file:///cache/scans/b.jpg");
  });

  it("keeps a page whose sharpness check throws, as unchecked", async () => {
    const { base } = deps({
      check: jest.fn(async () => {
        throw new Error("decode");
      }),
    });
    const result = await prepareScans(["file:///cache/scans/a.jpg"], base);

    expect(result.pages).toEqual([{ uri: "file:///cache/ready/a.jpg", sharpness: "unchecked" }]);
  });

  it("erases everything and returns nothing once the screen is gone", async () => {
    let alive = true;
    const { base, discarded } = deps({
      alive: () => alive,
      normalize: jest.fn(async (uri: string) => {
        alive = false;
        return uri.replace("scans/", "ready/");
      }),
    });
    const result = await prepareScans(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"], base);

    expect(result.pages).toEqual([]);
    expect(discarded).toEqual(expect.arrayContaining(["file:///cache/scans/a.jpg", "file:///cache/ready/a.jpg", "file:///cache/scans/b.jpg"]));
  });
});

describe("sendSeries", () => {
  function runner(results: SendResult[] | ((page: SeriesPage) => SendResult)) {
    const calls: SeriesPage[] = [];
    const discarded: string[] = [];
    const started: number[] = [];
    const queue = Array.isArray(results) ? [...results] : null;
    return {
      calls,
      discarded,
      started,
      deps: {
        send: jest.fn(async (page: SeriesPage): Promise<SendResult> => {
          calls.push(page);
          return queue === null ? (results as (page: SeriesPage) => SendResult)(page) : (queue.shift() as SendResult);
        }),
        discard: (uri: string) => {
          discarded.push(uri);
        },
        onProgress: (index: number) => {
          started.push(index);
        },
      },
    };
  }

  it("sends the pages one at a time, in order, and erases each file once sent", async () => {
    const run = runner([
      { status: "sent", pageId: "p1" },
      { status: "sent", pageId: "p2" },
      { status: "sent", pageId: "p3" },
    ]);
    const result = await sendSeries(pages(3), run.deps);

    expect(result).toEqual({ sent: ["p1", "p2", "p3"], rejected: 0, pending: [], stop: null });
    expect(run.calls.map((page) => page.uri)).toEqual(pages(3).map((page) => page.uri));
    expect(run.started).toEqual([0, 1, 2]);
    expect(run.discarded).toEqual(pages(3).map((page) => page.uri));
  });

  it("starts the next page only after the previous one is answered", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const deps = {
      send: jest.fn(async (page: SeriesPage): Promise<SendResult> => {
        order.push(`start ${page.uri}`);
        if (page.uri.endsWith("page-1.jpg")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        order.push(`end ${page.uri}`);
        return { status: "sent", pageId: page.uri };
      }),
      discard: () => undefined,
    };
    const running = sendSeries(pages(2), deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start file:///cache/page-1.jpg"]);
    release?.();
    await running;

    expect(order).toEqual([
      "start file:///cache/page-1.jpg",
      "end file:///cache/page-1.jpg",
      "start file:///cache/page-2.jpg",
      "end file:///cache/page-2.jpg",
    ]);
  });

  it("stops at a limit on page k: no page after k is sent, and the pages not sent are returned", async () => {
    const run = runner([
      { status: "sent", pageId: "p1" },
      { status: "limit", reason: "monthly_limit", pageId: "p2" },
    ]);
    const result = await sendSeries(pages(5), run.deps);

    expect(run.calls).toHaveLength(2);
    expect(result.sent).toEqual(["p1"]);
    expect(result.stop).toEqual({ status: "limit", reason: "monthly_limit" });
    expect(result.pending.map((page) => page.uri)).toEqual(pages(5).slice(1).map((page) => page.uri));
    expect(run.discarded).toEqual([pages(5)[0].uri]);
  });

  it("stops at a lost network, keeps the page that was created so the retry reuses it, and sends nothing after", async () => {
    const run = runner([
      { status: "sent", pageId: "p1" },
      { status: "network", pageId: "p2" },
    ]);
    const result = await sendSeries(pages(4), run.deps);

    expect(run.calls).toHaveLength(2);
    expect(result.stop).toEqual({ status: "network" });
    expect(result.pending).toEqual([
      { uri: pages(4)[1].uri, pageId: "p2" },
      { uri: pages(4)[2].uri, pageId: null },
      { uri: pages(4)[3].uri, pageId: null },
    ]);
  });

  it("keeps the page id it already had when a failure answers without one", async () => {
    const run = runner([{ status: "failed", pageId: null }]);
    const result = await sendSeries([{ uri: pages(1)[0].uri, pageId: "old" }], run.deps);

    expect(result.stop).toEqual({ status: "failed" });
    expect(result.pending).toEqual([{ uri: pages(1)[0].uri, pageId: "old" }]);
  });

  it("leaves out a page the server cannot read or that is too heavy, erases it and goes on", async () => {
    const run = runner([
      { status: "photo", pageId: "p1" },
      { status: "tooLarge", pageId: "p2" },
      { status: "sent", pageId: "p3" },
    ]);
    const result = await sendSeries(pages(3), run.deps);

    expect(result).toEqual({ sent: ["p3"], rejected: 2, pending: [], stop: null });
    expect(run.discarded).toEqual(pages(3).map((page) => page.uri));
  });

  it("stops before a page once the screen is gone", async () => {
    let alive = true;
    const calls: string[] = [];
    const result = await sendSeries(pages(3), {
      send: async (page) => {
        calls.push(page.uri);
        alive = false;
        return { status: "sent", pageId: "p1" };
      },
      discard: () => undefined,
      alive: () => alive,
    });

    expect(calls).toHaveLength(1);
    expect(result.sent).toEqual(["p1"]);
    expect(result.stop).toEqual({ status: "cancelled" });
    expect(result.pending).toHaveLength(2);
  });

  it("an empty series sends nothing", async () => {
    const run = runner([]);

    expect(await sendSeries([], run.deps)).toEqual({ sent: [], rejected: 0, pending: [], stop: null });
  });
});

describe("replaceAt", () => {
  it("replaces one page and keeps the others in place", () => {
    const list: CheckedPage[] = [
      { uri: "a", sharpness: "sharp" },
      { uri: "b", sharpness: "blurry" },
      { uri: "c", sharpness: "sharp" },
    ];

    expect(replaceAt(list, 1, { uri: "b2", sharpness: "sharp" })).toEqual([
      { uri: "a", sharpness: "sharp" },
      { uri: "b2", sharpness: "sharp" },
      { uri: "c", sharpness: "sharp" },
    ]);
    expect(list[1].uri).toBe("b");
  });

  it("changes nothing for a place that does not exist", () => {
    const list: CheckedPage[] = [{ uri: "a", sharpness: "sharp" }];

    expect(replaceAt(list, 3, { uri: "x", sharpness: "sharp" })).toEqual(list);
    expect(replaceAt(list, -1, { uri: "x", sharpness: "sharp" })).toEqual(list);
  });
});

describe("destination", () => {
  it("opens the page for one page", () => {
    expect(destination(["p1"], "n1", null)).toBe("/page/p1");
    expect(destination(["p1"], "n1", "c1")).toBe("/page/p1");
  });

  it("opens the chapter for two pages or more, or the notebook when the pages are in none", () => {
    expect(destination(["p1", "p2"], "n1", "c1")).toBe("/chapter/c1");
    expect(destination(["p1", "p2", "p3"], "n1", null)).toBe("/notebook/n1");
  });

  it("opens nothing when nothing was sent", () => {
    expect(destination([], "n1", "c1")).toBeNull();
  });
});
