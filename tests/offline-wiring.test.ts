import { captureService } from "@/capture/service";
import { notebookService } from "@/notebooks/service";
import { pageService } from "@/pages/service";
import { renderService } from "@/render/service";

import { chapter, notebook, page } from "./offline-fixtures";

const mockCalls: string[] = [];
const mockMirror = {
  notebooks: jest.fn(async (list: unknown) => void mockCalls.push(`notebooks:${JSON.stringify(list)}`)),
  chapters: jest.fn(async (list: unknown) => void mockCalls.push(`chapters:${JSON.stringify(list)}`)),
  pages: jest.fn(async (list: unknown) => void mockCalls.push(`pages:${JSON.stringify(list)}`)),
  notebook: jest.fn(async (id: string, value: unknown) => void mockCalls.push(`notebook:${id}:${JSON.stringify(value)}`)),
  page: jest.fn(async (id: string, value: unknown) => void mockCalls.push(`page:${id}:${JSON.stringify(value)}`)),
  alerts: jest.fn(async (id: string, value: unknown) => void mockCalls.push(`alerts:${id}:${JSON.stringify(value)}`)),
  rendering: jest.fn(async (id: string, value: unknown) => void mockCalls.push(`rendering:${id}:${JSON.stringify(value)}`)),
  sentPhoto: jest.fn(async (id: string, uri: string) => void mockCalls.push(`sent:${id}:${uri}`)),
  openedPhoto: jest.fn(async (id: string) => void mockCalls.push(`opened:${id}`)),
};

jest.mock("@/offline/mirror", () => ({
  beginMirror: () => {
    mockCalls.push("begin");
    return mockMirror;
  },
}));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: { JPEG: "jpeg" } }));
jest.mock("@/offline/fetch-photo", () => ({ fetchPagePhoto: jest.fn(), fetchPhotoAt: jest.fn() }));

const mockPages = {
  listPages: jest.fn(),
  getPage: jest.fn(),
  photoUrl: jest.fn(),
};
jest.mock("@/pages/pages", () => ({
  ...jest.requireActual("@/pages/pages"),
  listPages: (...args: unknown[]) => mockPages.listPages(...args),
  getPage: (...args: unknown[]) => mockPages.getPage(...args),
  photoUrl: (...args: unknown[]) => mockPages.photoUrl(...args),
}));

const mockNotebooks = { listNotebooks: jest.fn(), getNotebook: jest.fn() };
jest.mock("@/notebooks/notebooks", () => ({
  ...jest.requireActual("@/notebooks/notebooks"),
  listNotebooks: (...args: unknown[]) => mockNotebooks.listNotebooks(...args),
  getNotebook: (...args: unknown[]) => mockNotebooks.getNotebook(...args),
}));

const mockChapters = { listChapters: jest.fn() };
jest.mock("@/notebooks/chapters", () => ({
  ...jest.requireActual("@/notebooks/chapters"),
  listChapters: (...args: unknown[]) => mockChapters.listChapters(...args),
}));

const mockAlerts = { listAlerts: jest.fn() };
jest.mock("@/pages/alerts", () => ({ listAlerts: (...args: unknown[]) => mockAlerts.listAlerts(...args) }));

const mockRender = { readRendering: jest.fn() };
jest.mock("@/render/api", () => ({
  ...jest.requireActual("@/render/api"),
  readRendering: (...args: unknown[]) => mockRender.readRendering(...args),
}));

const mockSend = { sendPage: jest.fn() };
jest.mock("@/capture/send-page", () => ({ sendPage: (...args: unknown[]) => mockSend.sendPage(...args) }));

const mockOpened: { pageId: string; load: () => Promise<unknown> }[] = [];

beforeEach(() => {
  mockCalls.length = 0;
  mockOpened.length = 0;
  jest.clearAllMocks();
  mockMirror.openedPhoto.mockImplementation(async (id: string, load?: unknown) => {
    mockOpened.push({ pageId: id, load: load as () => Promise<unknown> });
  });
});

describe("what the services write to the cache", () => {
  it("starts the request before the answer and writes the answer after it", async () => {
    const list = [{ ...page(1, 1), number: 1 }];
    mockPages.listPages.mockImplementation(async () => {
      mockCalls.push("request");
      return list;
    });
    await expect(pageService.list()).resolves.toBe(list);
    expect(mockCalls.slice(0, 2)).toEqual(["begin", "request"]);
    expect(mockMirror.pages).toHaveBeenCalledWith(list);
  });

  it("writes one page, or removes it when the server has none", async () => {
    const found = { ...page(1, 1), number: 1 };
    mockPages.getPage.mockResolvedValueOnce(found).mockResolvedValueOnce(null);
    await pageService.get(found.id);
    await pageService.get(found.id);
    expect(mockMirror.page).toHaveBeenNthCalledWith(1, found.id, found);
    expect(mockMirror.page).toHaveBeenNthCalledWith(2, found.id, null);
  });

  it("writes the notebooks, the chapters and one notebook", async () => {
    mockNotebooks.listNotebooks.mockResolvedValue([notebook(1)]);
    mockNotebooks.getNotebook.mockResolvedValueOnce(notebook(1)).mockResolvedValueOnce(null);
    mockChapters.listChapters.mockResolvedValue([chapter(1, 1)]);
    await notebookService.list();
    await notebookService.chapters();
    await notebookService.get(notebook(1).id);
    await notebookService.get(notebook(1).id);
    expect(mockMirror.notebooks).toHaveBeenCalledWith([notebook(1)]);
    expect(mockMirror.chapters).toHaveBeenCalledWith([chapter(1, 1)]);
    expect(mockMirror.notebook).toHaveBeenNthCalledWith(1, notebook(1).id, notebook(1));
    expect(mockMirror.notebook).toHaveBeenNthCalledWith(2, notebook(1).id, null);
  });

  it("writes the alerts and the rendering a page shows", async () => {
    mockAlerts.listAlerts.mockResolvedValue(["missing_line"]);
    mockRender.readRendering.mockResolvedValue({ text: "rich", basedOn: "abc" });
    await pageService.alerts(page(1, 1).id);
    await renderService.read(page(1, 1).id);
    expect(mockMirror.alerts).toHaveBeenCalledWith(page(1, 1).id, ["missing_line"]);
    expect(mockMirror.rendering).toHaveBeenCalledWith(page(1, 1).id, { text: "rich", basedOn: "abc" });
  });

  it("gives the answer even when the cache fails", async () => {
    const list = [{ ...page(1, 1), number: 1 }];
    mockPages.listPages.mockResolvedValue(list);
    mockMirror.pages.mockRejectedValueOnce(new Error("disk full"));
    await expect(pageService.list()).resolves.toBe(list);
  });

  it("does not hide a failure of the server", async () => {
    mockPages.listPages.mockRejectedValue(new Error("The pages could not be loaded."));
    await expect(pageService.list()).rejects.toThrow("The pages could not be loaded.");
    expect(mockMirror.pages).not.toHaveBeenCalled();
  });
});

describe("the photo of a page", () => {
  it("keeps the photo opened online, without delaying the address", async () => {
    mockPages.photoUrl.mockResolvedValue("https://storage.example/signed");
    await expect(pageService.photoUrl("user", page(1, 1).id)).resolves.toBe("https://storage.example/signed");
    expect(mockOpened.map((call) => call.pageId)).toEqual([page(1, 1).id]);
  });

  it("keeps the prepared photo of a page that was sent, before the caller can erase it", async () => {
    mockSend.sendPage.mockResolvedValue({ status: "sent", pageId: page(1, 1).id });
    const input = { notebookId: notebook(1).id, photoUri: "file:///cache/prepared.jpg", pageId: null };
    await expect(captureService.send(input)).resolves.toEqual({ status: "sent", pageId: page(1, 1).id });
    expect(mockMirror.sentPhoto).toHaveBeenCalledWith(page(1, 1).id, "file:///cache/prepared.jpg");
  });

  it("keeps nothing when the page was not sent", async () => {
    for (const result of [
      { status: "limit", reason: "monthly", pageId: page(1, 1).id },
      { status: "network", pageId: null },
      { status: "failed", pageId: page(1, 1).id },
    ]) {
      mockSend.sendPage.mockResolvedValueOnce(result);
      await captureService.send({ notebookId: notebook(1).id, photoUri: "file:///cache/p.jpg", pageId: null });
    }
    expect(mockMirror.sentPhoto).not.toHaveBeenCalled();
  });
});
