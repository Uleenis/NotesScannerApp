import { saveExport, shareExport, sweepExports } from "@/export/files";

type Operation = { kind: string; uri: string; content?: string; to?: string; encoding?: string };

const mockOperations: Operation[] = [];
const mockFailures = { write: false, deleteFile: false, delete: false, print: false, printOnce: false, noData: false };
const mockListing: { name: string; directory: boolean }[] = [];

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
    write(content: string, options?: { encoding?: string }) {
      if (mockFailures.write) {
        throw Object.assign(new Error("write failed"), { code: "ERR_WRITE" });
      }
      mockOperations.push({ kind: "write", uri: this.uri, content, ...(options?.encoding ? { encoding: options.encoding } : {}) });
    }
    async move(destination: { uri: string }) {
      mockOperations.push({ kind: "move", uri: this.uri, to: destination.uri });
    }
    delete() {
      mockOperations.push({ kind: "delete-file", uri: this.uri });
      if (mockFailures.deleteFile) {
        throw Object.assign(new Error("delete failed"), { code: "ERR_INVALID_PERMISSION" });
      }
    }
  }
  class Directory extends Entry {
    get name() {
      return this.uri.split("/").pop() ?? "";
    }
    list() {
      return mockListing.map((entry) => (entry.directory ? new Directory(`file:///cache/${entry.name}`) : new File(`file:///cache/${entry.name}`)));
    }
    create() {
      mockOperations.push({ kind: "create", uri: this.uri });
    }
    delete() {
      mockOperations.push({ kind: "delete", uri: this.uri });
      if (mockFailures.delete) {
        throw new Error("delete failed");
      }
    }
  }
  return { File, Directory, Paths: { cache: new Directory("file:///cache") } };
});

const mockPrint = jest.fn(async (options: { html?: string; width?: number; height?: number; base64?: boolean }) => {
  if (mockFailures.print) {
    throw new Error("print failed");
  }
  if (mockFailures.printOnce) {
    mockFailures.printOnce = false;
    throw new Error("print failed once");
  }
  return { uri: "file:///root-cache/Print/abc.pdf", numberOfPages: 1, ...(options.base64 && !mockFailures.noData ? { base64: "JVBERi0xLjQK" } : {}) };
});

jest.mock("expo-print", () => ({ printToFileAsync: (options: { html?: string; width?: number; height?: number; base64?: boolean }) => mockPrint(options) }));

const mockSharing = { available: true, shareAsync: jest.fn(async (_uri: string, _options?: object) => undefined) };

jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockSharing.available,
  shareAsync: (uri: string, options?: object) => mockSharing.shareAsync(uri, options),
}));

beforeEach(() => {
  mockOperations.length = 0;
  mockListing.length = 0;
  mockFailures.write = false;
  mockFailures.deleteFile = false;
  mockFailures.noData = false;
  mockFailures.delete = false;
  mockFailures.print = false;
  mockFailures.printOnce = false;
  mockPrint.mockClear();
  mockSharing.available = true;
  mockSharing.shareAsync.mockClear();
});

describe("saveExport", () => {
  test("writes a Markdown file named after the export in a folder of its own", async () => {
    const saved = await saveExport({ format: "markdown", name: "Histoire", content: "# Titre\n" });

    const folder = mockOperations.find((operation) => operation.kind === "create")?.uri ?? "";
    expect(folder).toMatch(/^file:\/\/\/cache\/export-[a-z0-9]+$/);
    expect(mockOperations.find((operation) => operation.kind === "write")).toEqual({ kind: "write", uri: `${folder}/Histoire.md`, content: "# Titre\n" });
    expect(saved.uri).toBe(`${folder}/Histoire.md`);
  });

  test("uses a new folder each time", async () => {
    await saveExport({ format: "markdown", name: "A", content: "a" });
    await saveExport({ format: "markdown", name: "A", content: "a" });
    const folders = mockOperations.filter((operation) => operation.kind === "create").map((operation) => operation.uri);
    expect(new Set(folders).size).toBe(2);
  });

  test("prints the HTML on A4 and writes the printed data under its name, never moving the printed file", async () => {
    const saved = await saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" });

    expect(mockPrint).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>x</p>", width: 595, height: 842, base64: true }));
    const folder = mockOperations.find((operation) => operation.kind === "create")?.uri ?? "";
    expect(mockOperations.find((operation) => operation.kind === "write")).toEqual({ kind: "write", uri: `${folder}/Cours.pdf`, content: "JVBERi0xLjQK", encoding: "base64" });
    expect(mockOperations.some((operation) => operation.kind === "move")).toBe(false);
    expect(mockOperations.filter((operation) => operation.kind === "delete-file").map((operation) => operation.uri)).toEqual(["file:///root-cache/Print/abc.pdf"]);
    expect(saved.uri).toBe(`${folder}/Cours.pdf`);
  });

  test("keeps the PDF when the printed file cannot be erased, as in Expo Go", async () => {
    mockFailures.deleteFile = true;
    const saved = await saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" });

    const folder = mockOperations.find((operation) => operation.kind === "create")?.uri ?? "";
    expect(saved.uri).toBe(`${folder}/Cours.pdf`);
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(0);
  });

  test("erases the folder when it is discarded, and never throws", async () => {
    const saved = await saveExport({ format: "markdown", name: "A", content: "a" });
    mockFailures.delete = true;
    expect(() => saved.discard()).not.toThrow();
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(1);
  });

  test("erases the printed file and the folder when writing fails, and names the failure a write [4]", async () => {
    mockFailures.write = true;
    await expect(saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" })).rejects.toMatchObject({ name: "WriteFailed", code: "ERR_WRITE" });
    expect(mockOperations.filter((operation) => operation.kind === "delete-file").map((operation) => operation.uri)).toEqual(["file:///root-cache/Print/abc.pdf"]);
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(1);
  });

  test("names the failure a print when the print gives no data, and erases the folder", async () => {
    mockFailures.noData = true;
    await expect(saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" })).rejects.toMatchObject({ name: "PrintFailed" });
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(1);
  });

  test("names the failure a print when the print gives empty data, and writes nothing", async () => {
    mockPrint.mockResolvedValueOnce({ uri: "file:///root-cache/Print/abc.pdf", numberOfPages: 1, base64: "" });
    await expect(saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" })).rejects.toMatchObject({ name: "PrintFailed" });
    expect(mockOperations.some((operation) => operation.kind === "write")).toBe(false);
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(1);
  });

  test("erases the folder when the print fails twice, and names the failure a print [4]", async () => {
    mockFailures.print = true;
    await expect(saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" })).rejects.toMatchObject({ name: "PrintFailed" });
    expect(mockPrint).toHaveBeenCalledTimes(2);
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(1);
  });

  test("prints a second time when the first print fails [4]", async () => {
    mockFailures.printOnce = true;
    const saved = await saveExport({ format: "pdf", name: "Cours", content: "<p>x</p>" });

    expect(mockPrint).toHaveBeenCalledTimes(2);
    const folder = mockOperations.find((operation) => operation.kind === "create")?.uri ?? "";
    expect(saved.uri).toBe(`${folder}/Cours.pdf`);
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(0);
  });
});

describe("shareExport", () => {
  test("opens the share sheet for a PDF", async () => {
    expect(await shareExport("file:///x.pdf", "pdf")).toBe(true);
    expect(mockSharing.shareAsync).toHaveBeenCalledWith("file:///x.pdf", expect.objectContaining({ mimeType: "application/pdf", UTI: "com.adobe.pdf" }));
  });

  test("opens the share sheet for a Markdown file", async () => {
    expect(await shareExport("file:///x.md", "markdown")).toBe(true);
    expect(mockSharing.shareAsync).toHaveBeenCalledWith("file:///x.md", expect.objectContaining({ mimeType: "text/markdown", UTI: "net.daringfireball.markdown" }));
  });

  test("answers false and shares nothing when the phone cannot share", async () => {
    mockSharing.available = false;
    expect(await shareExport("file:///x.pdf", "pdf")).toBe(false);
    expect(mockSharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe("sweepExports", () => {
  test("erases the export folders left in the cache and nothing else", () => {
    mockListing.push(
      { name: "export-abc", directory: true },
      { name: "export-def", directory: true },
      { name: "Print", directory: true },
      { name: "export-file", directory: false },
      { name: "photo.jpg", directory: false },
    );

    sweepExports();

    expect(mockOperations.filter((operation) => operation.kind === "delete").map((operation) => operation.uri)).toEqual([
      "file:///cache/export-abc",
      "file:///cache/export-def",
    ]);
    expect(mockOperations.some((operation) => operation.kind === "delete-file")).toBe(false);
  });

  test("goes on when a folder cannot be erased", () => {
    mockListing.push({ name: "export-abc", directory: true }, { name: "export-def", directory: true });
    mockFailures.delete = true;
    expect(() => sweepExports()).not.toThrow();
    expect(mockOperations.filter((operation) => operation.kind === "delete")).toHaveLength(2);
  });

  test("runs before a new export is written", async () => {
    mockListing.push({ name: "export-old", directory: true });
    await saveExport({ format: "markdown", name: "A", content: "a" });
    const kinds = mockOperations.map((operation) => operation.kind);
    expect(kinds.indexOf("delete")).toBeLessThan(kinds.indexOf("create"));
  });
});
