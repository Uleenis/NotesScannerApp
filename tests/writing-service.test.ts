import { uploadPhoto } from "@/capture/api";
import { realRunDeps } from "@/training/writing-service";

const mockBytes = jest.fn();
const mockDelete = jest.fn();

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({ bytes: (...args: unknown[]) => mockBytes(...args), delete: (...args: unknown[]) => mockDelete(...args) })),
}));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({ marker: "client" }) }));
jest.mock("@/capture/api", () => ({ uploadPhoto: jest.fn() }));

const UPLOAD = { path: "u/writing-tests/t/1.jpg", token: "token-1" };

beforeEach(() => {
  mockBytes.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockDelete.mockReset();
  jest.mocked(uploadPhoto).mockReset().mockResolvedValue("uploaded");
});

test("uploads the bytes of the photo to the path and the token it was given", async () => {
  expect(await realRunDeps().upload(UPLOAD, "file:///one.jpg")).toBe("uploaded");
  expect(uploadPhoto).toHaveBeenCalledWith({ marker: "client" }, UPLOAD.path, UPLOAD.token, new Uint8Array([1, 2, 3]));
});

test("keeps the photo file after a successful upload, so that it can be sent again with another test", async () => {
  await realRunDeps().upload(UPLOAD, "file:///one.jpg");
  expect(mockDelete).not.toHaveBeenCalled();
});

test("says failed when the file cannot be read, and sends nothing", async () => {
  mockBytes.mockRejectedValue(new Error("gone"));
  expect(await realRunDeps().upload(UPLOAD, "file:///one.jpg")).toBe("failed");
  expect(uploadPhoto).not.toHaveBeenCalled();
});

test("passes on what the upload answers", async () => {
  jest.mocked(uploadPhoto).mockResolvedValue("tooLarge");
  expect(await realRunDeps().upload(UPLOAD, "file:///one.jpg")).toBe("tooLarge");
});
