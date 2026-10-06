import { fadeDelay, readingView, startReadingDelay } from "@/pages/reading-state";

const now = new Date(2026, 9, 6, 12, 0, 0);
const ago = (milliseconds: number) => new Date(now.getTime() - milliseconds).toISOString();

describe("readingView", () => {
  const view = (status: string, queueReason: string | null, attemptedAt: string | null = null) =>
    readingView({ status, queueReason, attemptedAt } as Parameters<typeof readingView>[0], now);

  test("waits for a page that is queued without a cause or being read", () => {
    expect(view("queued", null)).toEqual({ kind: "waiting" });
    expect(view("processing", null)).toEqual({ kind: "waiting" });
  });

  test("keeps waiting for a page that waits for the network, which this slice does not use", () => {
    expect(view("queued", "offline")).toEqual({ kind: "waiting" });
  });

  test("shows a delayed reading with the minutes before the next attempt", () => {
    expect(view("queued", "read_error", ago(5 * 60_000))).toEqual({ kind: "deferred", minutes: 10 });
    expect(view("queued", "read_error")).toEqual({ kind: "deferred", minutes: 15 });
  });

  test("shows a failed reading", () => {
    expect(view("failed", null)).toEqual({ kind: "failed" });
  });

  test("shows the document of a page that is read", () => {
    expect(view("read", null)).toEqual({ kind: "document" });
  });
});

describe("startReadingDelay", () => {
  const delay = (status: string, queueReason: string | null, uploadedAt: string) =>
    startReadingDelay({ status, queueReason, uploadedAt } as Parameters<typeof startReadingDelay>[0], now);

  test("asks to start a page that is queued without a cause once the capture had its time", () => {
    expect(delay("queued", null, ago(5_000))).toBe(0);
    expect(delay("queued", null, ago(60_000))).toBe(0);
  });

  test("waits for what is left of the 5 seconds given to the capture", () => {
    expect(delay("queued", null, ago(1_000))).toBe(4_000);
    expect(delay("queued", null, ago(0))).toBe(5_000);
  });

  test("never starts a page that is in any other state", () => {
    expect(delay("processing", null, ago(60_000))).toBeNull();
    expect(delay("queued", "read_error", ago(60_000))).toBeNull();
    expect(delay("queued", "offline", ago(60_000))).toBeNull();
    expect(delay("read", null, ago(60_000))).toBeNull();
    expect(delay("failed", null, ago(60_000))).toBeNull();
  });

  test("waits the full 5 seconds when the upload date cannot be read or is in the future", () => {
    expect(delay("queued", null, "not a date")).toBe(5_000);
    expect(delay("queued", null, ago(-30_000))).toBe(5_000);
  });
});

describe("fadeDelay", () => {
  test("lets the stroke finish its turn, 0.4 seconds at most", () => {
    expect(fadeDelay(0)).toBe(400);
    expect(fadeDelay(1_000)).toBe(400);
    expect(fadeDelay(1_500)).toBe(400);
  });

  test("waits only what is left of a turn of 2 seconds near its end", () => {
    expect(fadeDelay(1_700)).toBe(300);
    expect(fadeDelay(1_900)).toBe(100);
    expect(fadeDelay(3_850)).toBe(150);
  });

  test("waits 0.4 seconds at most when a new turn has just started", () => {
    expect(fadeDelay(2_000)).toBe(400);
    expect(fadeDelay(1_999)).toBe(1);
  });

  test("never waits more than 0.4 seconds nor a negative time", () => {
    for (let elapsed = 0; elapsed < 6_000; elapsed += 37) {
      const delay = fadeDelay(elapsed);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
    expect(fadeDelay(-500)).toBe(400);
  });
});
