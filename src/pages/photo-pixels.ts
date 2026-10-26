import type { PhotoSize } from "./frame";

export const HEADER_BYTES = 131_072;
export const MAX_SIDE = 8000;
export const MAX_PIXELS = 12_000_000;

const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const SCAN = 0xda;
const END = 0xd9;
const EXIF = 0xe1;
const ORIENTATION_TAG = 0x0112;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

export type HeaderLoader = (uri: string, headers: Record<string, string>) => Promise<ArrayBuffer>;

function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 14 || !EXIF_HEADER.every((value, index) => bytes[start + index] === value)) {
    return null;
  }
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) {
    return null;
  }
  const u16 = (at: number) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
  const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 0x10000 : u16(at) * 0x10000 + u16(at + 2));
  if (u16(tiff + 2) !== 42) {
    return null;
  }
  const directory = tiff + u32(tiff + 4);
  if (directory + 2 > end) {
    return null;
  }
  const count = u16(directory);
  for (let entry = 0; entry < count; entry += 1) {
    const at = directory + 2 + entry * 12;
    if (at + 12 > end) {
      return null;
    }
    if (u16(at) === ORIENTATION_TAG) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

export function jpegSize(bytes: Uint8Array): PhotoSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let orientation: number | null = null;
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      return null;
    }
    while (position < bytes.length && bytes[position] === 0xff) {
      position += 1;
    }
    if (position >= bytes.length) {
      return null;
    }
    const marker = bytes[position];
    position += 1;
    if (STANDALONE.has(marker)) {
      continue;
    }
    if (marker === SCAN || marker === END || position + 2 > bytes.length) {
      return null;
    }
    const length = (bytes[position] << 8) | bytes[position + 1];
    if (length < 2 || position + length > bytes.length) {
      return null;
    }
    if (marker === EXIF && orientation === null) {
      orientation = exifOrientation(bytes, position + 2, position + length);
    }
    if (FRAMES.has(marker)) {
      if (length < 7) {
        return null;
      }
      const height = (bytes[position + 3] << 8) | bytes[position + 4];
      const width = (bytes[position + 5] << 8) | bytes[position + 6];
      if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
        return null;
      }
      return orientation !== null && orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    position += length;
  }
  return null;
}

async function loadHeader(uri: string, headers: Record<string, string>): Promise<ArrayBuffer> {
  const response = await fetch(uri, { headers });
  if (!response.ok) {
    throw new Error("The photo could not be loaded.");
  }
  return response.arrayBuffer();
}

export async function readPhotoPixels(uri: string, load: HeaderLoader = loadHeader): Promise<PhotoSize | null> {
  try {
    const buffer = await load(uri, { Range: `bytes=0-${HEADER_BYTES - 1}` });
    return jpegSize(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_BYTES)));
  } catch {
    return null;
  }
}
