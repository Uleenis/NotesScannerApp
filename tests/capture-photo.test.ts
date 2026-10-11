import { MAX_PHOTO_PIXELS, orientationTag, preparePhoto, SENSOR_TO_VIEWFINDER, shrinkTarget, viewfinderTurn } from "@/capture/photo";

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

const taken = { uri: "file:///cache/taken.jpg", width: 4080, height: 3060, exif: { Orientation: 6 } };

test("the turn that brings back the viewfinder cancels the sense guessed by the phone", () => {
  expect(viewfinderTurn(6, 0)).toBe(0);
  expect(viewfinderTurn(1, 0)).toBe(90);
  expect(viewfinderTurn(3, 0)).toBe(270);
  expect(viewfinderTurn(8, 0)).toBe(180);
});

test("whatever the phone guessed, the photo ends up turned the same way from the sensor", () => {
  const applied: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 };
  for (const tag of [1, 3, 6, 8]) {
    expect((applied[tag] + viewfinderTurn(tag, 0)) % 360).toBe(SENSOR_TO_VIEWFINDER);
  }
});

test("each quarter turn asked by the user adds 90 degrees, and four come back to the start", () => {
  expect(viewfinderTurn(6, 1)).toBe(90);
  expect(viewfinderTurn(6, 2)).toBe(180);
  expect(viewfinderTurn(6, 3)).toBe(270);
  expect(viewfinderTurn(6, 4)).toBe(0);
  expect(viewfinderTurn(1, 3)).toBe(0);
});

test("a tag written as text is read as its number", () => {
  expect(viewfinderTurn("6", 0)).toBe(0);
  expect(viewfinderTurn("3", 0)).toBe(270);
});

test("a missing or unknown tag is taken as a photo the phone did not turn", () => {
  for (const tag of [undefined, null, "", "x", 0, 2, 9, Number.NaN]) {
    expect(viewfinderTurn(tag, 0)).toBe(90);
  }
});

test("the tag is read from the exif of the photo, and a photo without exif is not turned by the phone", () => {
  expect(orientationTag({ Orientation: 3 })).toBe(3);
  expect(orientationTag(undefined)).toBeUndefined();
  expect(orientationTag(null)).toBeUndefined();
  expect(orientationTag("6")).toBeUndefined();
  expect(orientationTag({})).toBeUndefined();
});

test("a photo is always saved again, turned as in the viewfinder, and the photo of the camera is kept", async () => {
  const save = jest.fn(async (): Promise<string> => "file:///cache/upright.jpg");

  expect(await preparePhoto(taken, 0, { save })).toBe("file:///cache/upright.jpg");
  expect(save).toHaveBeenCalledWith(taken.uri, 0);

  await preparePhoto({ ...taken, exif: { Orientation: 1 } }, 0, { save });
  expect(save).toHaveBeenLastCalledWith(taken.uri, 90);
});

test("a photo turned by the user starts again from the photo of the camera", async () => {
  const save = jest.fn(async (): Promise<string> => "file:///cache/upright.jpg");

  await preparePhoto(taken, 1, { save });
  expect(save).toHaveBeenCalledWith(taken.uri, 90);
});

test("a photo that cannot be turned is an error, never the photo of the camera sent as it is", async () => {
  const save = jest.fn(async (): Promise<string> => Promise.reject(new Error("no memory")));

  await expect(preparePhoto(taken, 0, { save })).rejects.toThrow("no memory");
});
