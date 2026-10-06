import { captureService } from "@/capture/service";
import { getSupabase } from "@/lib/supabase";

const mockFiles: { uri: string; deleted: boolean; bytes: Uint8Array; deleteFails: boolean }[] = [];
let mockDeleteFails = false;

jest.mock("expo-file-system", () => ({
  File: class {
    state: { uri: string; deleted: boolean; bytes: Uint8Array; deleteFails: boolean };
    constructor(uri: string) {
      this.state = { uri, deleted: false, bytes: new Uint8Array([0xff, 0xd8, 0xff]), deleteFails: mockDeleteFails };
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

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: () => ({
        renderAsync: async () => ({ saveAsync: async () => ({ uri: "file:///cache/shrunk.jpg" }) }),
      }),
    })),
  },
  SaveFormat: { JPEG: "jpeg" },
}));

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

test("a photo within the limit of pixels is used as it is", async () => {
  expect(await captureService.preparePhoto({ uri: "file:///cache/a.jpg", width: 3000, height: 4000 })).toBe("file:///cache/a.jpg");
});

test("a photo with too many pixels is replaced by a shrunk one", async () => {
  expect(await captureService.preparePhoto({ uri: "file:///cache/a.jpg", width: 6120, height: 8160 })).toBe("file:///cache/shrunk.jpg");
  expect(mockFiles.map((file) => [file.uri, file.deleted])).toEqual([["file:///cache/a.jpg", true]]);
});

test("a photo that is thrown away has its file deleted, and a missing file is no problem", () => {
  captureService.discardPhoto("file:///cache/a.jpg");
  expect(mockFiles.map((file) => file.deleted)).toEqual([true]);

  mockFiles.length = 0;
  mockDeleteFails = true;
  expect(() => captureService.discardPhoto("file:///cache/b.jpg")).not.toThrow();
});
