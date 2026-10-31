import { encode } from "jpeg-js";

import { shrinkTarget } from "@/capture/photo";
import { captureService } from "@/capture/service";
import { getSupabase } from "@/lib/supabase";

const mockFiles: { uri: string; deleted: boolean; bytes: Uint8Array; deleteFails: boolean }[] = [];
let mockDeleteFails = false;
let mockBytes: Uint8Array | null = null;

jest.mock("expo-file-system", () => ({
  File: class {
    state: { uri: string; deleted: boolean; bytes: Uint8Array; deleteFails: boolean };
    constructor(uri: string) {
      this.state = { uri, deleted: false, bytes: mockBytes ?? new Uint8Array([0xff, 0xd8, 0xff]), deleteFails: mockDeleteFails };
      mockFiles.push(this.state);
    }
    async bytes() {
      return this.state.bytes;
    }
    delete() {
      if (this.state.deleteFails) {
        throw new Error("already gone");
      }
      this.state.deleted = true;
    }
  },
}));

type MockImage = { name: string; width: number; height: number; released: boolean };

const mockImaging = {
  calls: [] as string[],
  sizes: [] as { width: number; height: number }[],
  saved: [] as unknown[],
  images: [] as MockImage[],
  fail: false,
};

jest.mock("expo-image-manipulator", () => {
  function image(name: string) {
    const size = mockImaging.sizes.shift() ?? { width: 3000, height: 4000 };
    const state: MockImage = { name, ...size, released: false };
    mockImaging.images.push(state);
    return {
      state,
      width: size.width,
      height: size.height,
      saveAsync: async (options: unknown) => {
        mockImaging.calls.push(`save ${name}`);
        mockImaging.saved.push(options);
        return { uri: `file:///cache/${name}.jpg`, width: size.width, height: size.height };
      },
      release: () => {
        state.released = true;
      },
    };
  }
  function context(source: string, steps: string[]) {
    return {
      rotate: (degrees: number) => context(source, [...steps, `rotate ${degrees}`]),
      resize: (size: { width: number; height: number }) => context(source, [...steps, `resize ${size.width}x${size.height}`]),
      renderAsync: async () => {
        mockImaging.calls.push(`render ${source}${steps.map((step) => ` ${step}`).join("")}`);
        if (mockImaging.fail) {
          throw new Error("no memory");
        }
        return image(steps.some((step) => step.startsWith("resize")) ? "shrunk" : "turned");
      },
      release: () => undefined,
    };
  }
  return {
    ImageManipulator: {
      manipulate: (source: string | { state: MockImage }) => context(typeof source === "string" ? source : `image:${source.state.name}`, []),
    },
    SaveFormat: { JPEG: "jpeg" },
  };
});

jest.mock("@/lib/supabase", () => ({ getSupabase: jest.fn() }));

type Step = string;

function fakeSupabase(options: { upload?: "ok" | "fail"; read?: Promise<unknown> } = {}) {
  const steps: Step[] = [];
  const client = {
    from: (table: string) => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            steps.push(`insert ${table}`);
            return { data: { id: "page-1" }, error: null };
          },
        }),
      }),
      update: (values: unknown) => ({
        eq: async () => {
          steps.push(`update ${table} ${JSON.stringify(values)}`);
          return { data: null, error: null };
        },
      }),
    }),
    functions: {
      invoke: async (name: string) => {
        steps.push(`invoke ${name}`);
        if (name === "prepare-page") {
          return { data: { path: "u/page-1/original.jpg", token: "t" }, error: null };
        }
        return options.read ?? { data: { status: "read" }, error: null };
      },
    },
    storage: {
      from: () => ({
        uploadToSignedUrl: async () => {
          steps.push("upload");
          return options.upload === "fail" ? { data: null, error: { statusCode: "500", message: "broken" } } : { data: { path: "p" }, error: null };
        },
      }),
    },
  };
  jest.mocked(getSupabase).mockReturnValue(client as never);
  return steps;
}

beforeEach(() => {
  mockFiles.length = 0;
  mockDeleteFails = false;
  mockBytes = null;
  mockImaging.calls = [];
  mockImaging.sizes = [];
  mockImaging.saved = [];
  mockImaging.images = [];
  mockImaging.fail = false;
});

const input = { notebookId: "notebook-1", photoUri: "file:///cache/photo.jpg", pageId: null };

test("sending a page runs the four steps in order and marks the page as uploaded", async () => {
  const steps = fakeSupabase();
  const result = await captureService.send(input);
  await Promise.resolve();

  expect(result).toEqual({ status: "sent", pageId: "page-1" });
  expect(steps.slice(0, 5)).toEqual([
    "insert pages",
    "invoke prepare-page",
    "upload",
    expect.stringMatching(/^update pages \{"uploaded_at":"/),
    "invoke read-page",
  ]);
});

test("the file of the photo is deleted after the upload, and kept when the upload fails", async () => {
  fakeSupabase();
  await captureService.send(input);
  expect(mockFiles.map((file) => file.deleted)).toEqual([true]);

  mockFiles.length = 0;
  fakeSupabase({ upload: "fail" });
  const failed = await captureService.send(input);
  expect(failed.status).toBe("failed");
  expect(mockFiles.map((file) => file.deleted)).toEqual([false]);
});

test("the caller is told when the answer of read-page arrives, not before", async () => {
  let release: (value: unknown) => void = () => {};
  const read = new Promise((resolve) => {
    release = resolve;
  });
  fakeSupabase({ read });
  const settled = jest.fn();
  await captureService.send(input, settled);

  expect(settled).not.toHaveBeenCalled();
  release({ data: { status: "read" }, error: null });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toHaveBeenCalledTimes(1);
});

test("when the photo is not sent no reading starts and the caller is not told", async () => {
  fakeSupabase({ upload: "fail" });
  const settled = jest.fn();
  await captureService.send(input, settled);
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(settled).not.toHaveBeenCalled();
});

const taken = { uri: "file:///cache/a.jpg", width: 4080, height: 3060, exif: { Orientation: 6 } };

test("a photo held as in the viewfinder is saved again as a JPEG, without being turned, and the photo of the camera is kept", async () => {
  expect(await captureService.preparePhoto(taken, 0)).toBe("file:///cache/turned.jpg");
  expect(mockImaging.calls).toEqual(["render file:///cache/a.jpg", "save turned"]);
  expect(mockImaging.saved).toEqual([{ format: "jpeg", compress: 0.9 }]);
  expect(mockFiles).toEqual([]);
});

test("a photo the phone turned the wrong way is turned back to the viewfinder before it is saved", async () => {
  await captureService.preparePhoto({ ...taken, exif: { Orientation: 3 } }, 0);
  expect(mockImaging.calls).toEqual(["render file:///cache/a.jpg rotate 270", "save turned"]);
});

test("a quarter turn asked by the user is added to the turn of the viewfinder", async () => {
  await captureService.preparePhoto({ ...taken, exif: { Orientation: 1 } }, 1);
  expect(mockImaging.calls).toEqual(["render file:///cache/a.jpg rotate 180", "save turned"]);
});

test("a photo with too many pixels is shrunk after it is turned, with its turned size, and compressed once", async () => {
  mockImaging.sizes = [{ width: 8160, height: 6120 }];
  expect(await captureService.preparePhoto({ ...taken, exif: { Orientation: 1 } }, 0)).toBe("file:///cache/shrunk.jpg");
  const target = shrinkTarget(8160, 6120);
  expect(mockImaging.calls).toEqual([
    "render file:///cache/a.jpg rotate 90",
    `render image:turned resize ${target?.width}x${target?.height}`,
    "save shrunk",
  ]);
  expect(mockImaging.saved).toHaveLength(1);
});

test("the 12.5 megapixels of the sensor of the test phone are brought under the limit", async () => {
  mockImaging.sizes = [{ width: 3060, height: 4080 }];
  await captureService.preparePhoto(taken, 0);
  const target = shrinkTarget(3060, 4080);
  expect(target).not.toBeNull();
  expect(mockImaging.calls[1]).toBe(`render image:turned resize ${target?.width}x${target?.height}`);
});

test("the images held in memory are released once the photo is saved", async () => {
  mockImaging.sizes = [{ width: 8160, height: 6120 }];
  await captureService.preparePhoto(taken, 0);
  expect(mockImaging.images.map((image) => image.released)).toEqual([true, true]);
});

test("a photo that cannot be turned fails, and nothing is saved", async () => {
  mockImaging.fail = true;
  await expect(captureService.preparePhoto(taken, 0)).rejects.toThrow("no memory");
  expect(mockImaging.saved).toEqual([]);
});

function flatJpeg(): Uint8Array {
  const data = new Uint8Array(40 * 30 * 4).fill(200);
  return new Uint8Array(encode({ data, width: 40, height: 30 }, 90).data);
}

test("the sharpness of a large photo is judged on a copy reduced to 1000 px, which is erased", async () => {
  mockImaging.sizes = [{ width: 3000, height: 4000 }];
  mockBytes = flatJpeg();

  expect(await captureService.checkSharpness("file:///cache/a.jpg")).toBe("blurry");
  expect(mockImaging.calls).toEqual(["render file:///cache/a.jpg", "render image:turned resize 750x1000", "save shrunk"]);
  expect(mockImaging.saved).toEqual([{ format: "jpeg", compress: 1 }]);
  expect(new Set(mockFiles.map((file) => file.uri))).toEqual(new Set(["file:///cache/shrunk.jpg"]));
  expect(mockFiles.some((file) => file.deleted)).toBe(true);
  expect(mockImaging.images.map((image) => image.released)).toEqual([true, true]);
});

test("a photo within 1000 px is judged as it is, and its own file is never erased", async () => {
  mockImaging.sizes = [{ width: 600, height: 800 }];
  mockBytes = flatJpeg();

  expect(await captureService.checkSharpness("file:///cache/a.jpg")).toBe("blurry");
  expect(mockImaging.calls).toEqual(["render file:///cache/a.jpg", "save turned"]);
  expect(new Set(mockFiles.map((file) => file.uri))).toEqual(new Set(["file:///cache/turned.jpg"]));
  expect(mockFiles.some((file) => file.deleted)).toBe(true);
});

test("a photo that cannot be read for sharpness is left unchecked, and the copy is still erased", async () => {
  mockImaging.sizes = [{ width: 3000, height: 4000 }];

  expect(await captureService.checkSharpness("file:///cache/a.jpg")).toBe("unchecked");
  expect(mockFiles.some((file) => file.deleted)).toBe(true);

  mockImaging.fail = true;
  expect(await captureService.checkSharpness("file:///cache/a.jpg")).toBe("unchecked");
});

test("a photo that is thrown away has its file deleted, and a missing file is no problem", () => {
  captureService.discardPhoto("file:///cache/a.jpg");
  expect(mockFiles.map((file) => file.deleted)).toEqual([true]);

  mockFiles.length = 0;
  mockDeleteFails = true;
  expect(() => captureService.discardPhoto("file:///cache/b.jpg")).not.toThrow();
});
