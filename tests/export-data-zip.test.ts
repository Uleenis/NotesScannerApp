import { strFromU8, unzipSync } from "fflate";

import { openZip } from "@/export/data/zip";

const mockWritten: Uint8Array[] = [];
const mockState = { closed: 0, created: 0, failWrites: false };

jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    create() {
      mockState.created += 1;
    }
    open() {
      return {
        writeBytes(bytes: Uint8Array) {
          if (mockState.failWrites) {
            throw new Error("disk full");
          }
          mockWritten.push(new Uint8Array(bytes));
        },
        close() {
          mockState.closed += 1;
        },
      };
    }
  }
  return { File, FileMode: { Truncate: "wt" } };
});

const PAGE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function archive(): Record<string, Uint8Array> {
  const size = mockWritten.reduce((total, chunk) => total + chunk.length, 0);
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of mockWritten) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return unzipSync(all);
}

function target() {
  const { File } = jest.requireMock("expo-file-system") as { File: new (uri: string) => never };
  return new File("file:///cache/export-x/data.zip");
}

beforeEach(() => {
  mockWritten.length = 0;
  mockState.closed = 0;
  mockState.created = 0;
  mockState.failWrites = false;
});

describe("openZip", () => {
  test("writes a valid archive with text and binary entries, text kept as UTF-8", () => {
    const sink = openZip(target());
    sink.addText("README.txt", "Écriture – 日本語");
    sink.addBinary(`pages/${PAGE}/original.jpg`, [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    sink.addText(`pages/${PAGE}/page.json`, "{}");
    sink.finish();

    const files = archive();
    expect(Object.keys(files).sort()).toEqual(["README.txt", `pages/${PAGE}/original.jpg`, `pages/${PAGE}/page.json`]);
    expect(strFromU8(files["README.txt"])).toBe("Écriture – 日本語");
    expect([...files[`pages/${PAGE}/original.jpg`]]).toEqual([1, 2, 3, 4, 5]);
    expect(mockState.closed).toBe(1);
    expect(mockState.created).toBe(1);
  });

  test("accepts the training file and the two sheets of a writing test", () => {
    const sink = openZip(target());
    sink.addText("training.json", "{}");
    sink.addBinary(`writing-tests/${PAGE}/1.jpg`, [new Uint8Array([1])]);
    sink.addBinary(`writing-tests/${PAGE}/2.jpg`, [new Uint8Array([2])]);
    sink.finish();

    expect(Object.keys(archive()).sort()).toEqual(["training.json", `writing-tests/${PAGE}/1.jpg`, `writing-tests/${PAGE}/2.jpg`]);
  });

  test("counts the bytes it wrote", () => {
    const sink = openZip(target());
    sink.addBinary(`pages/${PAGE}/prepared.jpg`, [new Uint8Array(1000)]);
    expect(sink.written()).toBeGreaterThanOrEqual(1000);
    sink.finish();
    expect(sink.written()).toBe(mockWritten.reduce((total, chunk) => total + chunk.length, 0));
  });

  test.each([
    ["a path that climbs out", "../evil.txt"],
    ["an absolute path", "/etc/passwd"],
    ["a name with a backslash", "pages\\x.json"],
    ["an unknown file", "notes.txt"],
    ["a page folder that is not an identifier", "pages/..%2f/page.json"],
    ["an upper case identifier", `pages/${PAGE.toUpperCase()}/page.json`],
    ["an unknown file in a page folder", `pages/${PAGE}/run.sh`],
    ["a nested path in a page folder", `pages/${PAGE}/x/page.json`],
    ["an empty name", ""],
    ["a writing test folder that is not an identifier", "writing-tests/..%2f/1.jpg"],
    ["an upper case writing test identifier", `writing-tests/${PAGE.toUpperCase()}/1.jpg`],
    ["a third sheet of a writing test", `writing-tests/${PAGE}/3.jpg`],
    ["a file of a writing test that is not a photo", `writing-tests/${PAGE}/1.json`],
    ["a nested path in a writing test folder", `writing-tests/${PAGE}/x/1.jpg`],
    ["a writing test file outside its folder", "writing-tests/1.jpg"],
    ["a second training file", "training2.json"],
  ])("refuses %s", (_, name) => {
    const sink = openZip(target());
    expect(() => sink.addText(name, "x")).toThrow();
    expect(() => sink.addBinary(name, [])).toThrow();
  });

  test("refuses the same name twice", () => {
    const sink = openZip(target());
    sink.addText("README.txt", "a");
    expect(() => sink.addText("README.txt", "b")).toThrow();
  });

  test("stops with a size error as soon as the limit is passed", () => {
    const sink = openZip(target(), 500);
    expect(() => sink.addBinary(`pages/${PAGE}/original.jpg`, [new Uint8Array(400), new Uint8Array(400)])).toThrow("too large");
  });

  test("reports a failing disk on the next call", () => {
    const sink = openZip(target());
    mockState.failWrites = true;
    expect(() => {
      sink.addText("README.txt", "a");
      sink.addText("export.json", "b");
      sink.finish();
    }).toThrow();
  });

  test("abort closes the file and writes nothing more", () => {
    const sink = openZip(target());
    sink.addText("README.txt", "a");
    sink.abort();
    expect(mockState.closed).toBe(1);
    expect(() => sink.addText("export.json", "b")).toThrow();
  });
});
