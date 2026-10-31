import { sweepScans } from "@/capture/sweep";

const mockDeleted: string[] = [];
let mockFailing = false;

jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
    }
    delete() {
      mockDeleted.push(this.uri);
      if (mockFailing) {
        throw new Error("already gone");
      }
    }
  }
  return { Directory, Paths: { cache: { uri: "file:///cache" } } };
});

beforeEach(() => {
  mockDeleted.length = 0;
  mockFailing = false;
});

test("the folders of the scanner, of the photo picker and of the image tool in the cache are erased, nothing else", () => {
  sweepScans();

  expect(mockDeleted).toEqual(["file:///cache/scans", "file:///cache/ImageManipulator", "file:///cache/ImagePicker"]);
});

test("a folder that is gone or cannot be erased stops nothing", () => {
  mockFailing = true;

  expect(() => sweepScans()).not.toThrow();
  expect(mockDeleted).toHaveLength(3);
});
