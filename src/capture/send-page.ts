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

export type UploadResult = "uploaded" | "network" | "refused" | "failed";

export type SendDeps = {
  createPage: (notebookId: string, capturedAt: string) => Promise<CreatePageResult>;
  preparePage: (pageId: string) => Promise<PrepareResult>;
  upload: (path: string, token: string, photoUri: string) => Promise<UploadResult>;
  startReading: (pageId: string) => void;
  now: () => string;
};

export type SendInput = { notebookId: string; photoUri: string; pageId: string | null };

export type SendResult =
  | { status: "sent"; pageId: string }
  | { status: "limit"; reason: BlockReason; pageId: string }
  | { status: "photo"; pageId: string }
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
  switch (prepared.status) {
    case "limit":
      return { status: "limit", reason: prepared.reason, pageId };
    case "network":
    case "failed":
      return { status: prepared.status, pageId };
    case "processing":
    case "read":
      return { status: "sent", pageId };
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

  deps.startReading(pageId);
  return { status: "sent", pageId };
}

export async function sendPage(deps: SendDeps, input: SendInput): Promise<SendResult> {
  let pageId = input.pageId;
  try {
    return await send(deps, input, (id) => {
      pageId = id;
    });
  } catch {
    return { status: "failed", pageId };
  }
}
