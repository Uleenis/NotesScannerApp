import * as ImagePicker from "expo-image-picker";

import {
  IMPORT_BYTES_MAX,
  IMPORT_PIXELS_MAX,
  IMPORT_SIDE_MAX,
  acceptableImport,
  importFormat,
  pickImages,
} from "@/capture/importer";
import { SCAN_PAGE_MAX } from "@/capture/scanner";

const mockFiles: Record<string, { size: number; head: Uint8Array }> = {};
const mockDeleted: string[] = [];

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

jest.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get size() {
      return mockFiles[this.uri]?.size ?? 0;
    }
    open() {
      const file = mockFiles[this.uri];
      if (file === undefined) {
        throw new Error("missing");
      }
      return { readBytes: (length: number) => file.head.slice(0, length), close: () => undefined };
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));

const launch = jest.mocked(ImagePicker.launchImageLibraryAsync);

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function jpeg(width: number, height: number): Uint8Array {
  const frame = [0xff, 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...frame, 0xff, 0xda, 0, 2, 0x12, 0x34, 0xff, 0xd9]);
}

function png(width: number, height: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
}

function webp(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
}

function heic(brand = "heic"): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...brand.split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
}

const dir = "file:///data/user/0/com.uleenis.notesscanner/cache/ImagePicker";

function put(name: string, head: Uint8Array, size = 2_000_000): string {
  const uri = `${dir}/${name}`;
  mockFiles[uri] = { size, head };
  return uri;
}

function pick(...assets: { uri: string; width?: number; height?: number }[]) {
  launch.mockResolvedValue({ canceled: false, assets: assets.map((asset) => ({ width: 3000, height: 4000, ...asset })) } as ImagePicker.ImagePickerResult);
}

beforeEach(() => {
  Object.keys(mockFiles).forEach((key) => delete mockFiles[key]);
  mockDeleted.length = 0;
  launch.mockReset();
});

describe("importFormat", () => {
  it("knows the four formats of the allow-list by their first bytes", () => {
    expect(importFormat(jpeg(10, 10))).toBe("jpeg");
    expect(importFormat(png(10, 10))).toBe("png");
    expect(importFormat(webp())).toBe("webp");
    expect(importFormat(heic())).toBe("heic");
    expect(importFormat(heic("mif1"))).toBe("heic");
  });

  it.each([
    ["a PDF", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]],
    ["a GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]],
    ["a video", [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]],
    ["a RIFF that is not an image", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ["a text", [0x68, 0x65, 0x6c, 0x6c, 0x6f]],
    ["an empty file", []],
  ])("refuses %s", (_name, bytes) => {
    expect(importFormat(new Uint8Array(bytes))).toBeNull();
  });
});

describe("acceptableImport", () => {
  const ok = { width: 3000, height: 4000 };

  it("accepts a photo of a phone, in each format", () => {
    expect(acceptableImport(ok, { size: 3_000_000, head: jpeg(3000, 4000) })).toBe(true);
    expect(acceptableImport(ok, { size: 9_000_000, head: png(3000, 4000) })).toBe(true);
    expect(acceptableImport(ok, { size: 2_000_000, head: webp() })).toBe(true);
    expect(acceptableImport(ok, { size: 2_000_000, head: heic() })).toBe(true);
  });

  it("accepts a very large photo up to the bound, which the reduction then brings to 12 Mpx", () => {
    expect(acceptableImport({ width: 8160, height: 6120 }, { size: 20_000_000, head: jpeg(8160, 6120) })).toBe(true);
    expect(IMPORT_PIXELS_MAX).toBe(50_000_000);
  });

  it("trusts the header of a JPEG or a PNG before the size the system reported", () => {
    expect(acceptableImport({ width: 100, height: 100 }, { size: 5000, head: jpeg(20_000, 20_000) })).toBe(false);
    expect(acceptableImport({ width: 100, height: 100 }, { size: 5000, head: png(60_000, 60_000) })).toBe(false);
    expect(acceptableImport({ width: 0, height: 0 }, { size: 5000, head: jpeg(3000, 4000) })).toBe(true);
  });

  it("holds a webp or a heic to the size the system reported, and refuses a missing one", () => {
    expect(acceptableImport({ width: 9000, height: 9000 }, { size: 5000, head: webp() })).toBe(false);
    expect(acceptableImport({ width: 0, height: 0 }, { size: 5000, head: heic() })).toBe(false);
    expect(acceptableImport({ width: Number.NaN, height: 100 }, { size: 5000, head: heic() })).toBe(false);
    expect(acceptableImport({ width: 10.5, height: 100 }, { size: 5000, head: heic() })).toBe(false);
    expect(acceptableImport({ width: -5, height: 100 }, { size: 5000, head: webp() })).toBe(false);
  });

  it.each([
    [IMPORT_SIDE_MAX + 1, 100],
    [100, IMPORT_SIDE_MAX + 1],
    [10_000, 5001],
  ])("refuses %i by %i pixels, a bomb of pixels in a small file", (width, height) => {
    expect(acceptableImport({ width, height }, { size: 4000, head: webp() })).toBe(false);
    expect(acceptableImport({ width, height }, { size: 4000, head: jpeg(width, height) })).toBe(false);
  });

  it("refuses an empty file, a file over the bound of bytes, and a cut or broken JPEG", () => {
    expect(acceptableImport(ok, { size: 0, head: jpeg(3000, 4000) })).toBe(false);
    expect(acceptableImport(ok, { size: IMPORT_BYTES_MAX + 1, head: jpeg(3000, 4000) })).toBe(false);
    expect(acceptableImport(ok, { size: IMPORT_BYTES_MAX, head: jpeg(3000, 4000) })).toBe(true);
    expect(acceptableImport(ok, { size: 5000, head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4]) })).toBe(false);
    expect(acceptableImport(ok, { size: 5000, head: png(0, 0) })).toBe(false);
    expect(acceptableImport(ok, { size: 5000, head: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) })).toBe(false);
  });
});

describe("pickImages", () => {
  it("opens the photo picker for images only, several at once, up to the limit, in the order chosen, with the file untouched", async () => {
    pick({ uri: put("a.jpg", jpeg(3000, 4000)) });
    await pickImages({ limit: 7 });

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        allowsEditing: false,
        selectionLimit: 7,
        orderedSelection: true,
        quality: 1,
        exif: false,
        base64: false,
      }),
    );
    expect(launch.mock.calls[0][0]).not.toHaveProperty("legacy", true);
  });

  it("refuses a limit outside 1 to 20 without opening anything", async () => {
    for (const limit of [0, -1, 21, 2.5, Number.NaN]) {
      await expect(pickImages({ limit })).rejects.toThrow(RangeError);
    }
    expect(SCAN_PAGE_MAX).toBe(20);
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns the files in the order chosen", async () => {
    const first = put("0a-1.jpg", jpeg(3000, 4000));
    const second = put("0b-2.png", png(3000, 4000));
    pick({ uri: second }, { uri: first });

    expect(await pickImages({ limit: 5 })).toEqual({ status: "picked", uris: [second, first], rejected: 0 });
    expect(mockDeleted).toEqual([]);
  });

  it("a cancelled picker, or one that answers nothing, creates nothing", async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickImages({ limit: 5 })).toEqual({ status: "cancelled" });
    launch.mockResolvedValue({ canceled: false, assets: [] } as unknown as ImagePicker.ImagePickerResult);
    expect(await pickImages({ limit: 5 })).toEqual({ status: "cancelled" });
  });

  it("a picker that throws, or answers an odd shape, is a failure", async () => {
    launch.mockRejectedValue(new Error("activity"));
    expect(await pickImages({ limit: 5 })).toEqual({ status: "failed" });
    launch.mockResolvedValue({ canceled: false, assets: "nope" } as unknown as ImagePicker.ImagePickerResult);
    expect(await pickImages({ limit: 5 })).toEqual({ status: "failed" });
  });

  it("more files than the limit is a failure, and every file of the picker's folder is erased", async () => {
    const files = ["a.jpg", "b.jpg", "c.jpg"].map((name) => put(name, jpeg(3000, 4000)));
    pick(...files.map((uri) => ({ uri })));

    expect(await pickImages({ limit: 2 })).toEqual({ status: "failed" });
    expect(mockDeleted).toEqual(files);
  });

  it("a file that does not decode is set aside, counted and erased, and the others go on", async () => {
    const good = put("good.jpg", jpeg(3000, 4000));
    const text = put("notes.jpg", new Uint8Array([0x68, 0x69]));
    const bomb = put("bomb.jpg", jpeg(30_000, 30_000), 9000);
    const huge = put("huge.png", png(3000, 4000), IMPORT_BYTES_MAX + 1);
    pick({ uri: text }, { uri: good }, { uri: bomb }, { uri: huge });

    expect(await pickImages({ limit: 5 })).toEqual({ status: "picked", uris: [good], rejected: 3 });
    expect(mockDeleted.sort()).toEqual([bomb, huge, text].sort());
  });

  it("a file that cannot be opened, or is gone, is set aside", async () => {
    const gone = `${dir}/gone.jpg`;
    pick({ uri: gone });

    expect(await pickImages({ limit: 5 })).toEqual({ status: "picked", uris: [], rejected: 1 });
  });

  it("only the files of the picker's folder are accepted, and no other address is ever erased", async () => {
    const outside = [
      "file:///data/user/0/com.uleenis.notesscanner/files/secret.jpg",
      "file:///data/user/0/com.uleenis.notesscanner/cache/ImagePicker/../../files/secret.jpg",
      "content://media/external/images/1",
      "https://example.com/a.jpg",
      "file:///cache/scans/a.jpg",
      `${dir}/sub/a.jpg`,
      `${dir}/a b.jpg`,
      `${dir}/.jpg`,
      "",
    ];
    outside.forEach((uri) => {
      mockFiles[uri] = { size: 2_000_000, head: jpeg(3000, 4000) };
    });
    pick(...outside.map((uri) => ({ uri })));

    expect(await pickImages({ limit: 20 })).toEqual({ status: "picked", uris: [], rejected: outside.length });
    expect(mockDeleted).toEqual([]);
  });

  it("an asset without an address counts as set aside", async () => {
    launch.mockResolvedValue({ canceled: false, assets: [{ width: 10, height: 10 }, null, 4] } as unknown as ImagePicker.ImagePickerResult);

    expect(await pickImages({ limit: 5 })).toEqual({ status: "picked", uris: [], rejected: 3 });
  });

  it("the same file twice is taken once", async () => {
    const one = put("one.jpg", jpeg(3000, 4000));
    pick({ uri: one }, { uri: one });

    expect(await pickImages({ limit: 5 })).toEqual({ status: "picked", uris: [one], rejected: 1 });
    expect(mockDeleted).toEqual([]);
  });
});
