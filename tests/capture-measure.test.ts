import { unzipSync } from "fflate";

import { measureArchive, shareMeasure, type MeasureDeps } from "@/capture/measure";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function deps(overrides: Partial<MeasureDeps> = {}) {
  const calls: string[] = [];
  const base: MeasureDeps = {
    read: jest.fn(async (uri: string) => {
      calls.push(`read ${uri}`);
      return bytes(uri.length, 255, 216);
    }),
    save: jest.fn((data: Uint8Array) => {
      calls.push(`save ${data.length > 0}`);
      return { uri: "file:///cache/export-x/scans.zip", discard: () => calls.push("discard zip") };
    }),
    share: jest.fn(async (uri: string) => {
      calls.push(`share ${uri}`);
    }),
    discard: jest.fn((uri: string) => {
      calls.push(`discard ${uri}`);
    }),
  };
  return { calls, deps: { ...base, ...overrides } };
}

describe("measureArchive", () => {
  it("names the pages by their order, from 01", () => {
    const archive = unzipSync(measureArchive([bytes(1), bytes(2, 2), bytes(3, 3, 3)]));

    expect(Object.keys(archive)).toEqual(["01.jpg", "02.jpg", "03.jpg"]);
    expect(Array.from(archive["02.jpg"])).toEqual([2, 2]);
  });

  it("keeps two digits up to the last measure page", () => {
    const pages = Array.from({ length: 30 }, (_, index) => bytes(index));

    expect(Object.keys(unzipSync(measureArchive(pages))).at(-1)).toBe("30.jpg");
  });
});

describe("shareMeasure", () => {
  it("shares one archive of the scanned pages, erases the pages and leaves the archive to the sweep", async () => {
    const { calls, deps: given } = deps();

    await expect(shareMeasure(["file:///cache/scans/a.jpg", "file:///cache/scans/b.jpg"], given)).resolves.toBe(true);

    expect(calls).toEqual([
      "read file:///cache/scans/a.jpg",
      "read file:///cache/scans/b.jpg",
      "save true",
      "share file:///cache/export-x/scans.zip",
      "discard file:///cache/scans/a.jpg",
      "discard file:///cache/scans/b.jpg",
    ]);
  });

  it("erases everything when the share fails", async () => {
    const { calls, deps: given } = deps({
      share: jest.fn(async () => {
        throw new Error("no share");
      }),
    });

    await expect(shareMeasure(["file:///cache/scans/a.jpg"], given)).resolves.toBe(false);

    expect(calls).toEqual(["read file:///cache/scans/a.jpg", "save true", "discard zip", "discard file:///cache/scans/a.jpg"]);
  });

  it("erases the pages when one cannot be read", async () => {
    const { calls, deps: given } = deps({
      read: jest.fn(async () => {
        throw new Error("unreadable");
      }),
    });

    await expect(shareMeasure(["file:///cache/scans/a.jpg"], given)).resolves.toBe(false);

    expect(calls).toEqual(["discard file:///cache/scans/a.jpg"]);
  });
});
