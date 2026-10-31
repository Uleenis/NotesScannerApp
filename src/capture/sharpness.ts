import { decode } from "jpeg-js";

import { MAX_PHOTO_PIXELS } from "./photo";

export const SHARPNESS_SIDE = 1000;

export const SHARPNESS_THRESHOLD = 0.55;

const DECODE_MAX_MEGAPIXELS = 2;

const DECODE_MAX_MEMORY_MB = 64;

export type Gray = { data: Uint8Array; width: number; height: number };

export type Sharpness = "sharp" | "blurry";

export type SharpnessCheck = Sharpness | "unchecked";

export type SharpnessTools = {
  decode: (uri: string) => Promise<Gray | null>;
};

export function sharpnessSize(width: number, height: number): { width: number; height: number } | null {
  const longSide = Math.max(width, height);
  if (!Number.isFinite(longSide) || Math.min(width, height) <= 0 || longSide <= SHARPNESS_SIDE) {
    return null;
  }
  const scale = SHARPNESS_SIDE / longSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function assertGray(gray: Gray): void {
  const { width, height, data } = gray;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PHOTO_PIXELS) {
    throw new RangeError("size");
  }
  if (data.length !== width * height) {
    throw new RangeError("data");
  }
}

function boxWeights(from: number, to: number): { start: number[]; weights: number[][] } {
  const ratio = from / to;
  const start: number[] = [];
  const weights: number[][] = [];
  for (let index = 0; index < to; index += 1) {
    const center = (index + 0.5) * ratio;
    const first = Math.max(0, Math.floor(center - ratio / 2 + 0.5));
    const last = Math.min(from, Math.floor(center + ratio / 2 + 0.5));
    const count = Math.max(1, last - first);
    start.push(Math.min(first, from - count));
    weights.push(new Array<number>(count).fill(1 / count));
  }
  return { start, weights };
}

export function reduceGray(gray: Gray): Gray {
  assertGray(gray);
  const longSide = Math.max(gray.width, gray.height);
  if (longSide <= SHARPNESS_SIDE) {
    return gray;
  }
  const scale = SHARPNESS_SIDE / longSide;
  const width = Math.max(1, Math.round(gray.width * scale));
  const height = Math.max(1, Math.round(gray.height * scale));
  const columns = boxWeights(gray.width, width);
  const rows = boxWeights(gray.height, height);
  const across = new Float64Array(width * gray.height);
  for (let y = 0; y < gray.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      const weights = columns.weights[x];
      for (let k = 0; k < weights.length; k += 1) {
        sum += gray.data[y * gray.width + columns.start[x] + k] * weights[k];
      }
      across[y * width + x] = sum;
    }
  }
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const weights = rows.weights[y];
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = 0; k < weights.length; k += 1) {
        sum += across[(rows.start[y] + k) * width + x] * weights[k];
      }
      data[y * width + x] = Math.round(sum);
    }
  }
  return { data, width, height };
}

export function laplacianVariance(gray: Gray): number {
  assertGray(gray);
  const { data, width, height } = gray;
  let sum = 0;
  let squares = 0;
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width;
    const row = y * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x += 1) {
      const value =
        data[up + x] + data[down + x] + data[row + Math.max(0, x - 1)] + data[row + Math.min(width - 1, x + 1)] - 4 * data[row + x];
      sum += value;
      squares += value * value;
    }
  }
  const count = width * height;
  const mean = sum / count;
  return squares / count - mean * mean;
}

export function imageVariance(gray: Gray): number {
  assertGray(gray);
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < gray.data.length; index += 1) {
    sum += gray.data[index];
    squares += gray.data[index] * gray.data[index];
  }
  const mean = sum / gray.data.length;
  return squares / gray.data.length - mean * mean;
}

export function sharpnessScore(gray: Gray): number {
  const reduced = reduceGray(gray);
  const variance = imageVariance(reduced);
  return variance <= 0 ? 0 : laplacianVariance(reduced) / variance;
}

export function judgeSharpness(gray: Gray): Sharpness {
  return sharpnessScore(gray) < SHARPNESS_THRESHOLD ? "blurry" : "sharp";
}

export function rgbaToGray(rgba: Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = Math.round((rgba[offset] * 299 + rgba[offset + 1] * 587 + rgba[offset + 2] * 114) / 1000);
  }
  return { data, width, height };
}

export function decodeJpegGray(bytes: Uint8Array): Gray | null {
  try {
    const image = decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: DECODE_MAX_MEGAPIXELS,
      maxMemoryUsageInMB: DECODE_MAX_MEMORY_MB,
    });
    return rgbaToGray(image.data, image.width, image.height);
  } catch {
    return null;
  }
}

export async function checkSharpness(uri: string, tools: SharpnessTools): Promise<SharpnessCheck> {
  try {
    const gray = await tools.decode(uri);
    return gray === null ? "unchecked" : judgeSharpness(gray);
  } catch {
    return "unchecked";
  }
}
