import { File } from "expo-file-system";

import { getSupabase } from "@/lib/supabase";
import type { Allowance } from "./allowance";
import { callPrepare, callRead, fetchAllowance, fetchLatestNotebookId, insertPage, uploadPhoto } from "./api";
import { sendPage, type SendDeps, type SendInput, type SendResult, type UploadResult } from "./send-page";

export type CaptureService = {
  allowance: () => Promise<Allowance | null>;
  latestNotebookId: () => Promise<string | null>;
  send: (input: SendInput) => Promise<SendResult>;
};

async function uploadFile(path: string, token: string, photoUri: string): Promise<UploadResult> {
  const file = new File(photoUri);
  const result = await uploadPhoto(getSupabase(), path, token, await file.bytes());
  if (result === "uploaded") {
    file.delete();
  }
  return result;
}

function realDeps(): SendDeps {
  const client = getSupabase();
  return {
    createPage: (notebookId, capturedAt) => insertPage(client, notebookId, capturedAt),
    preparePage: (pageId) => callPrepare(client, pageId),
    upload: uploadFile,
    startReading: (pageId) => {
      void callRead(client, pageId);
    },
    now: () => new Date().toISOString(),
  };
}

export const captureService: CaptureService = {
  allowance: () => fetchAllowance(getSupabase()),
  latestNotebookId: () => fetchLatestNotebookId(getSupabase()),
  send: (input) => sendPage(realDeps(), input),
};
