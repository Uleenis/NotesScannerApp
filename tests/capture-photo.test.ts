import { MAX_PHOTO_PIXELS, preparePhoto, shrinkTarget } from "@/capture/photo";

test("a photo within the limit of pixels is kept as it is", () => {
  expect(shrinkTarget(3000, 4000)).toBeNull();
  expect(shrinkTarget(1000, 1000)).toBeNull();
});

test("a photo from a 50 megapixel sensor is brought under the limit, keeping its proportions", () => {
  const target = shrinkTarget(6120, 8160);

  expect(target).not.toBeNull();
  if (target === null) {
    return;
  }
  expect(target.width * target.height).toBeLessThanOrEqual(MAX_PHOTO_PIXELS);
  expect(target.width * target.height).toBeGreaterThan(MAX_PHOTO_PIXELS * 0.95);
  expect(Math.abs(target.width / target.height - 6120 / 8160)).toBeLessThan(0.001);
});

test("a landscape photo is shrunk the same way", () => {
  const target = shrinkTarget(8160, 6120);

  expect(target).not.toBeNull();
  expect(target?.width).toBeGreaterThan(target?.height ?? Infinity);
});

test("a size that makes no sense is left alone", () => {
  expect(shrinkTarget(0, 0)).toBeNull();
  expect(shrinkTarget(Number.NaN, 4000)).toBeNull();
  expect(shrinkTarget(-10, 4000)).toBeNull();
});

const small = { uri: "file:///cache/small.jpg", width: 3000, height: 4000 };
const big = { uri: "file:///cache/big.jpg", width: 6120, height: 8160 };

function deps() {
  return {
    shrink: jest.fn(async (): Promise<string> => "file:///cache/shrunk.jpg"),
    remove: jest.fn(),
  };
}

test("a photo that is not too big is not touched", async () => {
  const { shrink, remove } = deps();

  expect(await preparePhoto(small, { shrink, remove })).toBe(small.uri);
  expect(shrink).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test("a photo that is too big is shrunk and the original file is deleted", async () => {
  const { shrink, remove } = deps();

  expect(await preparePhoto(big, { shrink, remove })).toBe("file:///cache/shrunk.jpg");
  expect(shrink).toHaveBeenCalledWith(big.uri, shrinkTarget(big.width, big.height));
  expect(remove).toHaveBeenCalledWith(big.uri);
});

test("when the shrinking fails the original photo is used and kept", async () => {
  const { remove } = deps();
  const shrink = jest.fn(async (): Promise<string> => Promise.reject(new Error("no memory")));

  expect(await preparePhoto(big, { shrink, remove })).toBe(big.uri);
  expect(remove).not.toHaveBeenCalled();
});

test("a file that cannot be deleted does not lose the shrunk photo", async () => {
  const { shrink } = deps();
  const remove = jest.fn(() => {
    throw new Error("already gone");
  });

  expect(await preparePhoto(big, { shrink, remove })).toBe("file:///cache/shrunk.jpg");
});
