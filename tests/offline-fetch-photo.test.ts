import { PHOTO_BYTES_MAX } from "@/offline/photos";
import { fetchPagePhoto, type FetchPhotoDeps } from "@/offline/fetch-photo";

import { USER, jpeg, uuid } from "./offline-fixtures";

type FakeResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function answer(body: Uint8Array, init: { status?: number; length?: string | null } = {}): FakeResponse {
  const status = init.status ?? 200;
  const length = init.length === undefined ? String(body.length) : init.length;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? length : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  };
}

function deps(overrides: Partial<FetchPhotoDeps> = {}): FetchPhotoDeps & { urls: string[]; paths: string[] } {
  const urls: string[] = [];
  const paths: string[] = [];
  return {
    urls,
    paths,
    signedUrl: async (path) => {
      paths.push(path);
      return "https://storage.example/photo?token=abc";
    },
    fetch: (async (url: string) => {
      urls.push(url);
      return answer(jpeg(5000));
    }) as unknown as FetchPhotoDeps["fetch"],
    ...overrides,
  };
}

describe("fetching the photo of a page", () => {
  it("asks for the original under the user and the page, and returns the bytes", async () => {
    const used = deps();
    const result = await fetchPagePhoto(used, USER, uuid(1));
    expect(used.paths).toEqual([`${USER}/${uuid(1)}/original.jpg`]);
    expect(used.urls).toEqual(["https://storage.example/photo?token=abc"]);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.bytes.length).toBe(5000);
  });

  it("refuses an identifier that is not a UUID before any call", async () => {
    const used = deps();
    await expect(fetchPagePhoto(used, USER, "../../x")).rejects.toThrow("invalid_id");
    expect(used.paths).toEqual([]);
  });

  it("says the network failed when the address or the download cannot be reached", async () => {
    const failedFetch = deps({
      fetch: (async () => {
        throw new TypeError("Network request failed");
      }) as unknown as FetchPhotoDeps["fetch"],
    });
    expect((await fetchPagePhoto(failedFetch, USER, uuid(1))).status).toBe("network");
    const failedUrl = deps({
      signedUrl: async () => {
        throw new TypeError("Network request failed");
      },
    });
    expect((await fetchPagePhoto(failedUrl, USER, uuid(1))).status).toBe("network");
  });

  it("says the photo is gone when the server does not have it", async () => {
    const missing = deps({
      fetch: (async () => answer(new Uint8Array(0), { status: 404 })) as unknown as FetchPhotoDeps["fetch"],
    });
    expect((await fetchPagePhoto(missing, USER, uuid(1))).status).toBe("gone");
    const noUrl = deps({
      signedUrl: async () => {
        throw new Error("Object not found");
      },
    });
    expect((await fetchPagePhoto(noUrl, USER, uuid(1))).status).toBe("gone");
  });

  it("stops on a server error without calling the photo gone", async () => {
    const broken = deps({
      fetch: (async () => answer(new Uint8Array(0), { status: 503 })) as unknown as FetchPhotoDeps["fetch"],
    });
    expect((await fetchPagePhoto(broken, USER, uuid(1))).status).toBe("network");
  });

  it("refuses a body that is empty, too large or not a JPEG", async () => {
    const cases: FakeResponse[] = [
      answer(new Uint8Array(0)),
      answer(jpeg(10), { length: String(PHOTO_BYTES_MAX + 1) }),
      answer(new Uint8Array(PHOTO_BYTES_MAX + 1), { length: null }),
      answer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])),
      answer(new TextEncoder().encode("<html>sign in</html>")),
    ];
    for (const response of cases) {
      const used = deps({ fetch: (async () => response) as unknown as FetchPhotoDeps["fetch"] });
      expect((await fetchPagePhoto(used, USER, uuid(1))).status).toBe("gone");
    }
  });

  it("does not read the body of a photo announced as too large", async () => {
    const response = answer(jpeg(10), { length: String(PHOTO_BYTES_MAX + 1) });
    const read = jest.spyOn(response, "arrayBuffer");
    const used = deps({ fetch: (async () => response) as unknown as FetchPhotoDeps["fetch"] });
    await fetchPagePhoto(used, USER, uuid(1));
    expect(read).not.toHaveBeenCalled();
  });
});
