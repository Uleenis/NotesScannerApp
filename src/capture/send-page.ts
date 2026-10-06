import type { BlockReason } from "./allowance";

export type CreatePageResult = { status: "created"; pageId: string } | { status: "network" } | { status: "failed" };

export type PrepareResult =
  | { status: "ready"; path: string; token: string }
  | { status: "exists" }
  | { status: "processing" }
  | { status: "read" }
  | { status: "limit"; reason: BlockReason }
  | { status: "network" }
  | { status: "failed" };

export type UploadResult = "uploaded" | "tooLarge" | "network" | "refused" | "failed";

export type MarkResult = "marked" | "network" | "failed";

export type SendDeps = {
  createPage: (notebookId: string, capturedAt: string) => Promise<CreatePageResult>;
  preparePage: (pageId: string) => Promise<PrepareResult>;
  upload: (path: string, token: string, photoUri: string) => Promise<UploadResult>;
  markUploaded: (pageId: string, uploadedAt: string) => Promise<MarkResult>;
  startReading: (pageId: string) => void;
  now: () => string;
  timeoutMs: number;
};

export type SendInput = { notebookId: string; photoUri: string; pageId: string | null };

export type SendResult =
  | { status: "sent"; pageId: string }
  | { status: "limit"; reason: BlockReason; pageId: string }
  | { status: "photo"; pageId: string }
  | { status: "tooLarge"; pageId: string }
  | { status: "network"; pageId: string | null }
  | { status: "failed"; pageId: string | null };

async function createOrReuse(deps: SendDeps, input: SendInput): Promise<CreatePageResult> {
  if (input.pageId !== null) {
    return { status: "created", pageId: input.pageId };
  }
  return deps.createPage(input.notebookId, deps.now());
}

async function send(deps: SendDeps, input: SendInput, track: (pageId: string) => void): Promise<SendResult> {
  const created = await createOrReuse(deps, input);
  if (created.status !== "created") {
    return { status: created.status, pageId: null };
  }
  const { pageId } = created;
  track(pageId);

  const prepared = await deps.preparePage(pageId);
  let reading = true;
  switch (prepared.status) {
    case "limit":
      return { status: "limit", reason: prepared.reason, pageId };
    case "network":
    case "failed":
      return { status: prepared.status, pageId };
    case "processing":
    case "read":
      reading = false;
      break;
    case "exists":
      break;
    case "ready": {
      const uploaded = await deps.upload(prepared.path, prepared.token, input.photoUri);
      if (uploaded === "refused") {
        return { status: "photo", pageId };
      }
      if (uploaded !== "uploaded") {
        return { status: uploaded, pageId };
      }
      break;
    }
  }

  const marked = await deps.markUploaded(pageId, deps.now());
  if (marked !== "marked") {
    return { status: marked, pageId };
  }
  if (reading) {
    deps.startReading(pageId);
  }
  return { status: "sent", pageId };
}

export async function sendPage(deps: SendDeps, input: SendInput): Promise<SendResult> {
  let pageId = input.pageId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", pageId }), deps.timeoutMs);
  });
  try {
    return await Promise.race([
      send(deps, input, (id) => {
        pageId = id;
      }),
      timeout,
    ]);
  } catch {
    return { status: "failed", pageId };
  } finally {
    clearTimeout(timer);
  }
}
