import { MEASURE_PAGE_MAX, SCAN_PAGE_MAX, scanForMeasure, scanLimit, scanPages, scannerAvailable } from "@/capture/scanner";

type Native = { isAvailable: jest.Mock; scan: jest.Mock };

const mockNative: { current: Native | null } = { current: null };
const mockDeleted: string[] = [];

jest.mock("../modules/document-scanner", () => ({
  documentScanner: () => mockNative.current,
}));

jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));

function native(scanned: unknown, available: unknown = true): Native {
  return {
    isAvailable: jest.fn(() => (available instanceof Error ? Promise.reject(available) : Promise.resolve(available))),
    scan: jest.fn(() => (scanned instanceof Error ? Promise.reject(scanned) : Promise.resolve(scanned))),
  };
}

const devFlag = globalThis as unknown as { __DEV__: boolean };

beforeEach(() => {
  mockNative.current = null;
  mockDeleted.length = 0;
  devFlag.__DEV__ = true;
});

describe("scanLimit", () => {
  it("is the smaller of the pages left and 20", () => {
    expect(SCAN_PAGE_MAX).toBe(20);
    expect(scanLimit(1)).toBe(1);
    expect(scanLimit(7)).toBe(7);
    expect(scanLimit(20)).toBe(20);
    expect(scanLimit(21)).toBe(20);
    expect(scanLimit(500)).toBe(20);
  });

  it("is never below zero nor a fraction", () => {
    expect(scanLimit(0)).toBe(0);
    expect(scanLimit(-3)).toBe(0);
    expect(scanLimit(2.7)).toBe(2);
    expect(scanLimit(Number.NaN)).toBe(0);
    expect(scanLimit(Number.POSITIVE_INFINITY)).toBe(20);
  });
});

describe("scanPages", () => {
  it("asks the native scanner for the limit with the gallery off", async () => {
    mockNative.current = native(["file:///cache/scans/a.jpg"]);

    await scanPages({ limit: 3 });

    expect(mockNative.current.scan).toHaveBeenCalledTimes(1);
    expect(mockNative.current.scan).toHaveBeenCalledWith(3, false);
  });

  it("gives the pages in the order the scanner returned them", async () => {
    mockNative.current = native(["file:///cache/scans/b.jpg", "file:///cache/scans/a.jpg", "file:///cache/scans/c.jpg"]);

    await expect(scanPages({ limit: 5 })).resolves.toEqual({
      status: "scanned",
      uris: ["file:///cache/scans/b.jpg", "file:///cache/scans/a.jpg", "file:///cache/scans/c.jpg"],
    });
    expect(mockDeleted).toEqual([]);
  });

  it("says cancelled when the user leaves the scanner without a page", async () => {
    mockNative.current = native([]);

    await expect(scanPages({ limit: 2 })).resolves.toEqual({ status: "cancelled" });
  });

  it("says unavailable without a native scanner", async () => {
    await expect(scanPages({ limit: 2 })).resolves.toEqual({ status: "unavailable" });
  });

  it("says unavailable when the device has no scanner", async () => {
    mockNative.current = native(["file:///cache/scans/a.jpg"], false);

    await expect(scanPages({ limit: 2 })).resolves.toEqual({ status: "unavailable" });
    expect(mockNative.current.scan).not.toHaveBeenCalled();
  });

  it("says failed when the scanner fails", async () => {
    mockNative.current = native(new Error("scan failed"));

    await expect(scanPages({ limit: 2 })).resolves.toEqual({ status: "failed" });
  });

  it.each([0, -1, 21, 2.5, Number.NaN])("refuses the limit %p without opening the scanner", async (limit) => {
    mockNative.current = native(["file:///cache/scans/a.jpg"]);

    await expect(scanPages({ limit })).rejects.toThrow(RangeError);
    expect(mockNative.current.scan).not.toHaveBeenCalled();
  });

  it("refuses more pages than the limit and erases them", async () => {
    mockNative.current = native(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg", "file:///cache/scans/c.jpg"]);

    await expect(scanPages({ limit: 2 })).resolves.toEqual({ status: "failed" });
    expect(mockDeleted).toEqual(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg", "file:///cache/scans/c.jpg"]);
  });

  it.each([
    ["not a list", "file:///cache/scans/a.jpg"],
    ["a list with a number", ["file:///cache/scans/a.jpg", 3]],
    ["a web address", ["file:///cache/scans/a.jpg", "https://example.com/a.jpg"]],
    ["a content address", ["content://media/external/images/1"]],
    ["an empty name", [""]],
  ])("refuses an answer that is %s and erases the files it named", async (_label, scanned) => {
    mockNative.current = native(scanned);

    await expect(scanPages({ limit: 5 })).resolves.toEqual({ status: "failed" });
    const named = (Array.isArray(scanned) ? scanned : [scanned]).filter(
      (item): item is string => typeof item === "string" && item.startsWith("file:///"),
    );
    expect(mockDeleted).toEqual(named);
  });
});

describe("scannerAvailable", () => {
  it("is false without a native scanner", async () => {
    await expect(scannerAvailable()).resolves.toBe(false);
  });

  it("follows the native answer", async () => {
    mockNative.current = native([], true);
    await expect(scannerAvailable()).resolves.toBe(true);
    mockNative.current = native([], false);
    await expect(scannerAvailable()).resolves.toBe(false);
  });

  it("is false when the check fails or answers something else", async () => {
    mockNative.current = native([], new Error("no play services"));
    await expect(scannerAvailable()).resolves.toBe(false);
    mockNative.current = native([], "yes");
    await expect(scannerAvailable()).resolves.toBe(false);
  });
});

describe("scanForMeasure", () => {
  it("opens the scanner with the gallery on in a development build", async () => {
    mockNative.current = native(["file:///cache/scans/a.jpg"]);

    await expect(scanForMeasure()).resolves.toEqual({ status: "scanned", uris: ["file:///cache/scans/a.jpg"] });
    expect(mockNative.current.scan).toHaveBeenCalledWith(MEASURE_PAGE_MAX, true);
  });

  it("never opens the scanner outside a development build", async () => {
    devFlag.__DEV__ = false;
    mockNative.current = native(["file:///cache/scans/a.jpg"]);

    await expect(scanForMeasure()).resolves.toEqual({ status: "unavailable" });
    expect(mockNative.current.scan).not.toHaveBeenCalled();
  });
});
