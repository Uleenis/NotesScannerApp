import { HEADER_BYTES, jpegSize, readPhotoPixels } from "@/pages/photo-pixels";

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function segment(marker: number, body: number[]): number[] {
  return [0xff, marker, ...u16(body.length + 2), ...body];
}

function exif(orientation: number, order: "II" | "MM" = "MM"): number[] {
  const little = order === "II";
  const w16 = (value: number) => (little ? [value & 0xff, (value >> 8) & 0xff] : u16(value));
  const w32 = (value: number) => (little ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff] : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  const tiff = [...order.split("").map((c) => c.charCodeAt(0)), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation), 0, 0, ...w32(0)];
  return segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
}

function frame(width: number, height: number, marker = 0xc0): number[] {
  return segment(marker, [8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
}

function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...parts.flat(), ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0x34, 0xff, 0xd9]);
}

const JFIF = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const TABLE = segment(0xdb, Array.from({ length: 65 }, (_, index) => index));

describe("jpegSize", () => {
  test("reads the size of a photo without EXIF", () => {
    expect(jpegSize(jpeg(JFIF, TABLE, frame(2258, 3262)))).toEqual({ width: 2258, height: 3262 });
  });

  test("reads the size of a progressive photo", () => {
    expect(jpegSize(jpeg(TABLE, frame(4000, 3000, 0xc2)))).toEqual({ width: 4000, height: 3000 });
  });

  test("keeps the size of an upright photo with EXIF", () => {
    expect(jpegSize(jpeg(exif(1), TABLE, frame(3000, 4000)))).toEqual({ width: 3000, height: 4000 });
  });

  test.each([5, 6, 7, 8])("swaps width and height for orientation %i, as the reading service turns the photo", (orientation) => {
    expect(jpegSize(jpeg(exif(orientation), TABLE, frame(4000, 3000)))).toEqual({ width: 3000, height: 4000 });
  });

  test("reads an EXIF written in little-endian order", () => {
    expect(jpegSize(jpeg(exif(6, "II"), frame(4000, 3000)))).toEqual({ width: 3000, height: 4000 });
  });

  test("goes past fill bytes between segments", () => {
    const bytes = jpeg(JFIF, [0xff, 0xff], frame(1200, 1600));
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 1600 });
  });

  test("refuses what is not a JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
    expect(jpegSize(new Uint8Array([]))).toBeNull();
  });

  test("refuses a header cut before its frame", () => {
    const whole = jpeg(JFIF, TABLE, frame(2258, 3262));
    expect(jpegSize(whole.subarray(0, 30))).toBeNull();
  });

  test("refuses a photo whose scan starts before any frame", () => {
    expect(jpegSize(jpeg(JFIF))).toBeNull();
  });

  test("refuses a segment that claims more bytes than there are", () => {
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0]))).toBeNull();
  });

  test.each([
    [0, 100],
    [100, 0],
    [8001, 100],
    [100, 8001],
    [4000, 3001],
  ])("refuses a size of %i by %i, outside the bounds of the reading service", (width, height) => {
    expect(jpegSize(jpeg(frame(width, height)))).toBeNull();
  });

  test("takes the bounds it is given in place of those of the reading service", () => {
    const wide = { side: 16_000, pixels: 50_000_000 };
    expect(jpegSize(jpeg(frame(8160, 6120)), wide)).toEqual({ width: 8160, height: 6120 });
    expect(jpegSize(jpeg(frame(8160, 6120)))).toBeNull();
    expect(jpegSize(jpeg(frame(16_001, 100)), wide)).toBeNull();
    expect(jpegSize(jpeg(frame(10_000, 5001)), wide)).toBeNull();
    expect(jpegSize(jpeg(frame(65_535, 65_535)), wide)).toBeNull();
  });

  test("ignores an EXIF that is cut or malformed and keeps the size as written", () => {
    const broken = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0xff, 0xff, 0xff, 0xff]);
    expect(jpegSize(jpeg(broken, frame(4000, 3000)))).toEqual({ width: 4000, height: 3000 });
  });
});

describe("readPhotoPixels", () => {
  test("asks only for the start of the photo and reads its size", async () => {
    const load = jest.fn(async () => jpeg(JFIF, frame(2258, 3262)).buffer as ArrayBuffer);
    expect(await readPhotoPixels("https://photos/one.jpg", load)).toEqual({ width: 2258, height: 3262 });
    expect(load).toHaveBeenCalledWith("https://photos/one.jpg", { Range: `bytes=0-${HEADER_BYTES - 1}` });
  });

  test("reads only the first bytes when the server sends the whole photo", async () => {
    const head = Array.from(jpeg(JFIF, frame(2258, 3262)));
    const whole = new Uint8Array(HEADER_BYTES + 10);
    whole.set(head.slice(0, head.length - 2));
    const load = jest.fn(async () => whole.buffer as ArrayBuffer);
    expect(await readPhotoPixels("https://photos/one.jpg", load)).toEqual({ width: 2258, height: 3262 });
  });

  test("fails, so that it is tried again, when the photo cannot be loaded", async () => {
    const load = jest.fn(async (): Promise<ArrayBuffer> => {
      throw new Error("offline");
    });
    await expect(readPhotoPixels("https://photos/one.jpg", load)).rejects.toThrow("offline");
  });
});
