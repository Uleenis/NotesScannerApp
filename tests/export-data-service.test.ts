import { fetchPhoto, openArchive, shareArchive } from "@/export/data/service";

const mockState = {
  deleted: [] as string[],
  created: [] as string[],
  downloadBytes: new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5]),
  downloadSize: 7,
  failDownload: false,
  sharing: true,
};
const mockShare = jest.fn(async (_uri: string, _options?: object) => undefined);

jest.mock("expo-file-system", () => {
  const join = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri))
      .join("/")
      .replace(/(?<=[^:/])\/+/g, "/");
  class Entry {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  class File extends Entry {
    size = 0;
    static async downloadFileAsync(_url: string, destination: File) {
      if (mockState.failDownload) {
        throw new Error("download failed");
      }
      destination.size = mockState.downloadSize;
      return destination;
    }
    create() {
      mockState.created.push(this.uri);
    }
    open() {
      let offset = 0;
      return {
        readBytes: (length: number) => {
          const chunk = mockState.downloadBytes.slice(offset, offset + length);
          offset += chunk.length;
          return chunk;
        },
        writeBytes: () => undefined,
        close: () => undefined,
      };
    }
  }
  class Directory extends Entry {
    get name() {
      return this.uri.split("/").pop() ?? "";
    }
    list() {
      return [];
    }
    create() {
      mockState.created.push(this.uri);
    }
    delete() {
      mockState.deleted.push(this.uri);
    }
  }
  return { File, Directory, FileMode: { ReadOnly: "r", Truncate: "wt" }, Paths: { cache: new Directory("file:///cache"), availableDiskSpace: 1 } };
});

jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockState.sharing,
  shareAsync: (uri: string, options?: object) => mockShare(uri, options),
}));

jest.mock("@/lib/supabase", () => ({ getSupabase: jest.fn() }));

function storage(result: { data: unknown; error: { message: string } | null }) {
  const createSignedUrl = jest.fn(async () => result);
  return { client: { storage: { from: () => ({ createSignedUrl }) } } as never, createSignedUrl };
}

beforeEach(() => {
  mockState.deleted = [];
  mockState.created = [];
  mockState.downloadBytes = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5]);
  mockState.downloadSize = 7;
  mockState.failDownload = false;
  mockState.sharing = true;
  mockShare.mockClear();
});

describe("fetchPhoto", () => {
  test("downloads the photo to a folder of its own and reads it in chunks", async () => {
    const { client, createSignedUrl } = storage({ data: { signedUrl: "https://files.example/photo" }, error: null });

    const source = await fetchPhoto(client, "user/page/original.jpg");

    expect(createSignedUrl).toHaveBeenCalledWith("user/page/original.jpg", expect.any(Number));
    const chunks = [...(source?.chunks() ?? [])];
    expect(chunks.flatMap((chunk) => [...chunk])).toEqual([0xff, 0xd8, 1, 2, 3, 4, 5]);
    expect(mockState.created.some((uri) => /\/export-photo-[a-z0-9]+$/.test(uri))).toBe(true);
    source?.dispose();
    expect(mockState.deleted).toHaveLength(1);
  });

  test("answers null for a photo that is not stored", async () => {
    const { client } = storage({ data: null, error: { message: "Object not found" } });

    expect(await fetchPhoto(client, "user/page/original.jpg")).toBeNull();
  });

  test("throws for any other failure", async () => {
    const { client } = storage({ data: null, error: { message: "network down" } });

    await expect(fetchPhoto(client, "user/page/original.jpg")).rejects.toThrow();
  });

  test("throws when the answer has no address", async () => {
    const { client } = storage({ data: {}, error: null });

    await expect(fetchPhoto(client, "user/page/original.jpg")).rejects.toThrow();
  });

  test.each([
    ["is not a JPEG", () => (mockState.downloadBytes = new Uint8Array([0x3c, 0x68, 1, 2]))],
    ["is too large", () => (mockState.downloadSize = 50 * 1024 * 1024)],
    ["cannot be downloaded", () => (mockState.failDownload = true)],
  ])("erases its folder and throws when the file %s", async (_, arrange) => {
    arrange();
    const { client } = storage({ data: { signedUrl: "https://files.example/photo" }, error: null });

    await expect(fetchPhoto(client, "user/page/original.jpg")).rejects.toThrow();
    expect(mockState.deleted).toHaveLength(1);
  });
});

describe("openArchive", () => {
  test("opens a zip named after the export in a new export folder", () => {
    const saved = openArchive("donnees-notes-2026-10-24");

    expect(saved.uri).toMatch(/^file:\/\/\/cache\/export-[a-z0-9]+\/donnees-notes-2026-10-24\.zip$/);
    saved.discard();
    expect(mockState.deleted).toHaveLength(1);
  });

  test("reduces a hostile name to the allowed characters", () => {
    const saved = openArchive("../../etc/x y");

    expect(saved.uri).toMatch(/^file:\/\/\/cache\/export-[a-z0-9]+\/[A-Za-z0-9._-]+\.zip$/);
  });
});

describe("shareArchive", () => {
  test("shares the zip through the system sheet", async () => {
    expect(await shareArchive("file:///cache/export-x/data.zip")).toBe(true);
    expect(mockShare).toHaveBeenCalledWith("file:///cache/export-x/data.zip", expect.objectContaining({ mimeType: "application/zip" }));
  });

  test("says when sharing is not available", async () => {
    mockState.sharing = false;

    expect(await shareArchive("file:///cache/export-x/data.zip")).toBe(false);
    expect(mockShare).not.toHaveBeenCalled();
  });
});
