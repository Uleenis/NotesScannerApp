import { sendPage, type PrepareResult, type SendDeps } from "@/capture/send-page";

const NOTEBOOK = "notebook-1";
const PHOTO = "file:///cache/photo.jpg";
const NOW = "2026-10-06T10:00:00.000Z";

type Calls = string[];

function makeDeps(change: Partial<SendDeps> = {}): { deps: SendDeps; calls: Calls } {
  const calls: Calls = [];
  const deps: SendDeps = {
    createPage: jest.fn(async () => {
      calls.push("createPage");
      return { status: "created" as const, pageId: "page-1" };
    }),
    preparePage: jest.fn(async () => {
      calls.push("preparePage");
      return { status: "ready" as const, path: "user/page-1/original.jpg", token: "upload-token" };
    }),
    upload: jest.fn(async () => {
      calls.push("upload");
      return "uploaded" as const;
    }),
    markUploaded: jest.fn(async () => {
      calls.push("markUploaded");
      return "marked" as const;
    }),
    startReading: jest.fn(() => {
      calls.push("startReading");
    }),
    now: () => NOW,
    timeoutMs: 1000,
    ...change,
  };
  return { deps, calls };
}

test("a page is created, prepared, uploaded, marked as uploaded, then sent to reading, in that order", async () => {
  const { deps, calls } = makeDeps();
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "sent", pageId: "page-1" });
  expect(calls).toEqual(["createPage", "preparePage", "upload", "markUploaded", "startReading"]);
});

test("the page is created in the chosen notebook with the moment of the capture", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(deps.createPage).toHaveBeenCalledWith(NOTEBOOK, NOW, null, "camera");
});

test("the photo goes to the address the server prepared, with its token", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(deps.preparePage).toHaveBeenCalledWith("page-1");
  expect(deps.upload).toHaveBeenCalledWith("user/page-1/original.jpg", "upload-token", PHOTO);
  expect(deps.startReading).toHaveBeenCalledWith("page-1");
});

test("a page that already exists is not created again when sending is retried", async () => {
  const { deps } = makeDeps();
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: "page-9" });

  expect(deps.createPage).not.toHaveBeenCalled();
  expect(deps.preparePage).toHaveBeenCalledWith("page-9");
  expect(result).toEqual({ status: "sent", pageId: "page-9" });
});

test("a failed upload keeps the page for the next try and never starts the reading", async () => {
  const { deps } = makeDeps({ upload: jest.fn(async () => "failed" as const) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "failed", pageId: "page-1" });
  expect(deps.startReading).not.toHaveBeenCalled();
});

test("an upload that loses the network is reported as a network failure, with the page kept", async () => {
  const { deps } = makeDeps({ upload: jest.fn(async () => "network" as const) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "network", pageId: "page-1" });
  expect(deps.startReading).not.toHaveBeenCalled();
});

test("a photo already in the storage is not uploaded again and the reading starts", async () => {
  const { deps } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "exists" })) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: "page-9" });

  expect(deps.upload).not.toHaveBeenCalled();
  expect(deps.startReading).toHaveBeenCalledWith("page-9");
  expect(result).toEqual({ status: "sent", pageId: "page-9" });
});

test("a page already being read or already read counts as sent, without a second reading", async () => {
  for (const status of ["processing", "read"] as const) {
    const { deps } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status })) });
    const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: "page-9" });

    expect(result).toEqual({ status: "sent", pageId: "page-9" });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.startReading).not.toHaveBeenCalled();
    expect(deps.markUploaded).toHaveBeenCalledWith("page-9", NOW);
  }
});

test("the page is marked as uploaded with the moment of the sending, once the photo is in the storage", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(deps.markUploaded).toHaveBeenCalledTimes(1);
  expect(deps.markUploaded).toHaveBeenCalledWith("page-1", NOW);
});

test("a photo already in the storage is marked as uploaded too, so a retried page shows up", async () => {
  const { deps, calls } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "exists" })) });
  await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: "page-9" });

  expect(calls).toEqual(["markUploaded", "startReading"]);
});

test("a page that cannot be marked as uploaded is not read and keeps its id for the next try", async () => {
  for (const marked of ["failed", "network"] as const) {
    const { deps } = makeDeps({ markUploaded: jest.fn(async () => marked) });
    const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

    expect(result).toEqual({ status: marked, pageId: "page-1" });
    expect(deps.startReading).not.toHaveBeenCalled();
  }
});

test("a refused page or a failed upload is never marked as uploaded", async () => {
  const limit = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "limit", reason: "monthly_limit" })) });
  await sendPage(limit.deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });
  const lost = makeDeps({ upload: jest.fn(async () => "network" as const) });
  await sendPage(lost.deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(limit.deps.markUploaded).not.toHaveBeenCalled();
  expect(lost.deps.markUploaded).not.toHaveBeenCalled();
});

test("a photo that is too heavy is reported on its own and never marked", async () => {
  const { deps } = makeDeps({ upload: jest.fn(async () => "tooLarge" as const) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "tooLarge", pageId: "page-1" });
  expect(deps.markUploaded).not.toHaveBeenCalled();
  expect(deps.startReading).not.toHaveBeenCalled();
});

describe("a step that never answers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("ends as a failure after the time allowed, with the page kept for the next try", async () => {
    const { deps } = makeDeps({ upload: jest.fn(() => new Promise<never>(() => {})) });
    const sending = sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });
    await jest.advanceTimersByTimeAsync(1000);

    expect(await sending).toEqual({ status: "failed", pageId: "page-1" });
    expect(deps.startReading).not.toHaveBeenCalled();
  });

  test("a sending that answers in time leaves no timer behind", async () => {
    const { deps } = makeDeps();
    await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

    expect(jest.getTimerCount()).toBe(0);
  });
});

test("each limit the server refuses is reported with its reason and nothing is uploaded", async () => {
  for (const reason of ["monthly_limit", "anonymous_limit", "anonymous_daily_cap"] as const) {
    const { deps } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "limit", reason })) });
    const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

    expect(result).toEqual({ status: "limit", reason, pageId: "page-1" });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.startReading).not.toHaveBeenCalled();
  }
});

test("a failure to create the page stops everything and keeps no page", async () => {
  const { deps } = makeDeps({ createPage: jest.fn(async () => ({ status: "failed" as const })) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "failed", pageId: null });
  expect(deps.preparePage).not.toHaveBeenCalled();
});

test("losing the network while creating the page is a network failure", async () => {
  const { deps } = makeDeps({ createPage: jest.fn(async () => ({ status: "network" as const })) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "network", pageId: null });
});

test("losing the network while preparing the page keeps the page", async () => {
  const { deps } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "network" })) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "network", pageId: "page-1" });
});

test("any other refusal while preparing is a failure that keeps the page", async () => {
  const { deps } = makeDeps({ preparePage: jest.fn(async (): Promise<PrepareResult> => ({ status: "failed" })) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "failed", pageId: "page-1" });
  expect(deps.upload).not.toHaveBeenCalled();
});

test("an exception thrown by a step becomes a failure, never an unhandled error", async () => {
  const { deps } = makeDeps({ upload: jest.fn(async () => Promise.reject(new Error("boom"))) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "failed", pageId: "page-1" });
  expect(deps.startReading).not.toHaveBeenCalled();
});

test("a photo the storage refuses is reported as a photo problem and never read", async () => {
  const { deps } = makeDeps({ upload: jest.fn(async () => "refused" as const) });
  const result = await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: null });

  expect(result).toEqual({ status: "photo", pageId: "page-1" });
  expect(deps.startReading).not.toHaveBeenCalled();
});

test("a page sent for a chapter is created in that chapter", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, chapterId: "chapter-3", photoUri: PHOTO, pageId: null });

  expect(deps.createPage).toHaveBeenCalledWith(NOTEBOOK, NOW, "chapter-3", "camera");
});

test("a page imported from the gallery is created with the import source [9]", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, chapterId: "chapter-3", photoUri: PHOTO, pageId: null, source: "import" });

  expect(deps.createPage).toHaveBeenCalledWith(NOTEBOOK, NOW, "chapter-3", "import");
});

test("a page that already exists is not created again, whatever its source", async () => {
  const { deps } = makeDeps();
  await sendPage(deps, { notebookId: NOTEBOOK, photoUri: PHOTO, pageId: "page-9", source: "import" });

  expect(deps.createPage).not.toHaveBeenCalled();
});
