import { encode } from "jpeg-js";

import {
  checkSharpness,
  decodeJpegGray,
  imageVariance,
  judgeSharpness,
  laplacianVariance,
  reduceGray,
  rgbaToGray,
  SHARPNESS_SIDE,
  SHARPNESS_THRESHOLD,
  sharpnessScore,
  sharpnessSize,
} from "@/capture/sharpness";
import { enlarge, gaussianBlur, motionBlur, syntheticPage } from "./fixtures/synthetic-page";

const SEEDS = [1, 2, 3, 4, 5, 6];

const BLURS: [string, (page: ReturnType<typeof syntheticPage>) => ReturnType<typeof syntheticPage>][] = [
  ["gaussian 1 px", (page) => gaussianBlur(page, 1)],
  ["gaussian 2 px", (page) => gaussianBlur(page, 2)],
  ["motion 12 px", (page) => motionBlur(page, 12, 20)],
  ["motion 24 px", (page) => motionBlur(page, 24, 20)],
];

test("the threshold and the side are those of measure 16, redone on paper photographs", () => {
  expect(SHARPNESS_SIDE).toBe(1000);
  expect(SHARPNESS_THRESHOLD).toBe(0.55);
});

test.each(SEEDS)("a sharp synthetic page (seed %i) passes", (seed) => {
  const page = syntheticPage(seed);

  expect(sharpnessScore(page)).toBeGreaterThan(SHARPNESS_THRESHOLD * 1.4);
  expect(judgeSharpness(page)).toBe("sharp");
});

test.each(BLURS)("every synthetic page blurred by %s is signalled", (_name, blur) => {
  SEEDS.forEach((seed) => {
    const blurred = blur(syntheticPage(seed));

    expect(sharpnessScore(blurred)).toBeLessThan(SHARPNESS_THRESHOLD);
    expect(judgeSharpness(blurred)).toBe("blurry");
  });
});

test("a large sharp image is reduced to 1000 px on its long side before the judgement", () => {
  const base = syntheticPage(3, 750, 1000);
  const large = enlarge(base, 2);

  const reduced = reduceGray(large);

  expect(large.height).toBe(2000);
  expect(Math.max(reduced.width, reduced.height)).toBe(SHARPNESS_SIDE);
  expect(reduced.width).toBe(750);
  expect(reduced.data).toEqual(base.data);
  expect(judgeSharpness(large)).toBe("sharp");
  expect(judgeSharpness(enlarge(gaussianBlur(base, 2), 2))).toBe("blurry");
});

test("an image already within 1000 px is not enlarged", () => {
  const page = syntheticPage(2, 300, 400);

  expect(reduceGray(page)).toEqual(page);
});

test("the size to reduce to keeps the proportions and never enlarges", () => {
  expect(sharpnessSize(3000, 4000)).toEqual({ width: 750, height: 1000 });
  expect(sharpnessSize(4080, 3060)).toEqual({ width: 1000, height: 750 });
  expect(sharpnessSize(1000, 700)).toBeNull();
  expect(sharpnessSize(600, 800)).toBeNull();
  expect(sharpnessSize(0, 4000)).toBeNull();
  expect(sharpnessSize(Number.NaN, 4000)).toBeNull();
});

test("the reduction averages boxes of pixels", () => {
  const data = new Uint8Array(2000 * 2);
  for (let x = 0; x < 2000; x += 1) {
    data[x] = x % 2 === 0 ? 0 : 100;
    data[2000 + x] = x % 2 === 0 ? 100 : 0;
  }

  const reduced = reduceGray({ data, width: 2000, height: 2 });

  expect(reduced.width).toBe(1000);
  expect(reduced.height).toBe(1);
  expect(Array.from(reduced.data.slice(0, 3))).toEqual([50, 50, 50]);
});

test("a blank page is signalled as blurry", () => {
  expect(judgeSharpness({ data: new Uint8Array(750 * 1000).fill(240), width: 750, height: 1000 })).toBe("blurry");
});

test("the variance of the Laplacian is computed with replicated edges", () => {
  const data = new Uint8Array(9);
  data[4] = 10;

  expect(laplacianVariance({ data, width: 3, height: 3 })).toBeCloseTo(2000 / 9, 6);
  expect(laplacianVariance({ data: new Uint8Array(12).fill(77), width: 4, height: 3 })).toBe(0);
});

test("the variance of the pixels is the population variance, and a flat image scores zero", () => {
  expect(imageVariance({ data: new Uint8Array([0, 100, 0, 100]), width: 2, height: 2 })).toBe(2500);
  expect(sharpnessScore({ data: new Uint8Array(12).fill(90), width: 4, height: 3 })).toBe(0);
});

test("the score does not depend on the contrast of the ink: a faint sharp page passes, a faint blurred one is signalled", () => {
  const faint = (page: ReturnType<typeof syntheticPage>) => ({
    ...page,
    data: Uint8Array.from(page.data, (value) => Math.round(232 - (232 - value) * 0.25)),
  });
  const page = syntheticPage(4);

  expect(Math.abs(sharpnessScore(faint(page)) - sharpnessScore(page))).toBeLessThan(0.15 * sharpnessScore(page));
  expect(judgeSharpness(faint(page))).toBe("sharp");
  expect(judgeSharpness(faint(gaussianBlur(page, 1)))).toBe("blurry");
});

test.each([
  [{ data: new Uint8Array(5), width: 2, height: 2 }],
  [{ data: new Uint8Array(0), width: 0, height: 0 }],
  [{ data: new Uint8Array(4), width: 2.5, height: 1.6 }],
  [{ data: new Uint8Array(4), width: -2, height: -2 }],
  [{ data: new Uint8Array(4), width: Number.NaN, height: 4 }],
])("an image whose size does not match its pixels is refused", (gray) => {
  expect(() => judgeSharpness(gray)).toThrow(RangeError);
});

test("an image above the bound of pixels is refused before any work", () => {
  expect(() => judgeSharpness({ data: new Uint8Array(4), width: 20_000, height: 20_000 })).toThrow(RangeError);
});

test("pixels turn to grey with the weights of the luminance and ignore the alpha", () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 10, 0, 0, 255, 0, 255, 255, 255, 255]);

  expect(Array.from(rgbaToGray(rgba, 4, 1).data)).toEqual([76, 150, 29, 255]);
});

function jpegOf(width: number, height: number, level: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = level;
    data[index + 1] = level;
    data[index + 2] = level;
    data[index + 3] = 255;
  }
  return new Uint8Array(encode({ data, width, height }, 90).data);
}

test("a JPEG is decoded to grey pixels", () => {
  const gray = decodeJpegGray(jpegOf(64, 48, 128));

  expect(gray).not.toBeNull();
  expect(gray?.width).toBe(64);
  expect(gray?.height).toBe(48);
  expect(Math.abs((gray?.data[100] ?? 0) - 128)).toBeLessThanOrEqual(2);
});

test("bytes that are not a JPEG decode to nothing", () => {
  expect(decodeJpegGray(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  expect(decodeJpegGray(new Uint8Array(0))).toBeNull();
  expect(decodeJpegGray(jpegOf(64, 48, 128).slice(0, 200))).toBeNull();
});

test("a JPEG above two megapixels is refused by the decoder", () => {
  expect(decodeJpegGray(jpegOf(1500, 1400, 128))).toBeNull();
});

test("a check hands the file to the tools and returns the verdict", async () => {
  const seen: string[] = [];
  const sharp = syntheticPage(5);
  const blurry = gaussianBlur(sharp, 2);

  const first = await checkSharpness("file:///scans/a.jpg", {
    decode: async (uri) => {
      seen.push(uri);
      return sharp;
    },
  });
  const second = await checkSharpness("file:///scans/b.jpg", { decode: async () => blurry });

  expect(first).toBe("sharp");
  expect(second).toBe("blurry");
  expect(seen).toEqual(["file:///scans/a.jpg"]);
});

test("a file that cannot be decoded is left unchecked, never signalled as blurry", async () => {
  expect(await checkSharpness("file:///scans/a.jpg", { decode: async () => null })).toBe("unchecked");
  expect(
    await checkSharpness("file:///scans/a.jpg", {
      decode: async () => {
        throw new Error("gone");
      },
    }),
  ).toBe("unchecked");
});
