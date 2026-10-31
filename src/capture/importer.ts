import { File, FileMode } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { jpegSize, type PixelBounds } from "@/pages/photo-pixels";
import { SCAN_PAGE_MAX } from "./scanner";

export const IMPORT_PIXELS_MAX = 50_000_000;

export const IMPORT_SIDE_MAX = 16_000;

export const IMPORT_BYTES_MAX = 64 * 1024 * 1024;

const HEAD_BYTES = 131_072;

const BOUNDS: PixelBounds = { side: IMPORT_SIDE_MAX, pixels: IMPORT_PIXELS_MAX };

const PICKED_FILE = /^file:\/\/\/(?!.*\.\.)(?:[^/]+\/)+ImagePicker\/[A-Za-z0-9-]+\.[A-Za-z0-9]{2,5}$/;

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export type ImportFormat = "jpeg" | "png" | "webp" | "heic";

export type PickResult = { status: "picked"; uris: string[]; rejected: number } | { status: "cancelled" } | { status: "failed" };

type Head = { size: number; head: Uint8Array };

type Reported = { width: number; height: number };

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(start, start + length)));
}

function u32(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

export function importFormat(head: Uint8Array): ImportFormat | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "jpeg";
  }
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === "PNG" && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) {
    return "png";
  }
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    return "webp";
  }
  if (head.length >= 12 && ascii(head, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(head, 8, 4))) {
    return "heic";
  }
  return null;
}

function pngSize(head: Uint8Array): Reported | null {
  if (head.length < 24 || ascii(head, 12, 4) !== "IHDR") {
    return null;
  }
  return { width: u32(head, 16), height: u32(head, 20) };
}

function withinBounds({ width, height }: Reported): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= IMPORT_SIDE_MAX &&
    height <= IMPORT_SIDE_MAX &&
    width * height <= IMPORT_PIXELS_MAX
  );
}

export function acceptableImport(reported: Reported, file: Head): boolean {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > IMPORT_BYTES_MAX) {
    return false;
  }
  switch (importFormat(file.head)) {
    case "jpeg": {
      const size = jpegSize(file.head, BOUNDS);
      return size !== null && withinBounds(size);
    }
    case "png": {
      const size = pngSize(file.head);
      return size !== null && withinBounds(size);
    }
    case "webp":
    case "heic":
      return withinBounds(reported);
    default:
      return false;
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

function discard(uri: string): void {
  if (!PICKED_FILE.test(uri)) {
    return;
  }
  try {
    new File(uri).delete();
  } catch {
    return;
  }
}

function readHead(uri: string): Head | null {
  try {
    const file = new File(uri);
    const size = file.size;
    const handle = file.open(FileMode.ReadOnly);
    try {
      return { size, head: handle.readBytes(HEAD_BYTES) };
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

export async function pickImages({ limit }: { limit: number }): Promise<PickResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > SCAN_PAGE_MAX) {
    return Promise.reject(new RangeError("limit"));
  }
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      allowsEditing: false,
      selectionLimit: limit,
      orderedSelection: true,
      quality: 1,
      exif: false,
      base64: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
  } catch {
    return { status: "failed" };
  }
  if (result.canceled) {
    return { status: "cancelled" };
  }
  const assets: unknown = result.assets;
  if (!Array.isArray(assets)) {
    return { status: "failed" };
  }
  if (assets.length === 0) {
    return { status: "cancelled" };
  }
  const addresses = assets.map((asset) => field(asset, "uri"));
  if (assets.length > limit) {
    addresses.forEach((uri) => typeof uri === "string" && discard(uri));
    return { status: "failed" };
  }
  const uris: string[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const [index, asset] of assets.entries()) {
    const uri = addresses[index];
    if (typeof uri !== "string" || !PICKED_FILE.test(uri) || seen.has(uri)) {
      rejected += 1;
      continue;
    }
    seen.add(uri);
    const file = readHead(uri);
    const width = field(asset, "width");
    const height = field(asset, "height");
    const reported = { width: typeof width === "number" ? width : Number.NaN, height: typeof height === "number" ? height : Number.NaN };
    if (file !== null && acceptableImport(reported, file)) {
      uris.push(uri);
    } else {
      discard(uri);
      rejected += 1;
    }
  }
  return { status: "picked", uris, rejected };
}
