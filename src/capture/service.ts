import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { getSupabase } from "@/lib/supabase";
import type { Allowance } from "./allowance";
import { callPrepare, callRead, fetchAllowance, fetchLatestNotebookId, insertPage, markUploaded, uploadPhotoFile } from "./api";
import { PHOTO_QUALITY, preparePhoto, type PhotoSize, type Picture } from "./photo";
import { sendPage, type SendDeps, type SendInput, type SendResult } from "./send-page";

const SEND_TIMEOUT_MS = 120_000;

export type CaptureService = {
  allowance: () => Promise<Allowance | null>;
  latestNotebookId: () => Promise<string | null>;
  send: (input: SendInput, onReadingSettled?: () => void) => Promise<SendResult>;
  preparePhoto: (picture: Picture) => Promise<string>;
  discardPhoto: (uri: string) => void;
};

function realDeps(onReadingSettled?: () => void): SendDeps {
  const client = getSupabase();
  return {
    createPage: (notebookId, capturedAt) => insertPage(client, notebookId, capturedAt),
    preparePage: (pageId) => callPrepare(client, pageId),
    upload: (path, token, photoUri) => uploadPhotoFile(client, new File(photoUri), path, token),
    markUploaded: (pageId, uploadedAt) => markUploaded(client, pageId, uploadedAt),
    startReading: (pageId) => {
      void callRead(client, pageId).then(() => onReadingSettled?.());
    },
    now: () => new Date().toISOString(),
    timeoutMs: SEND_TIMEOUT_MS,
  };
}

async function shrink(uri: string, size: PhotoSize): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
  return saved.uri;
}

function discardPhoto(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    return;
  }
}

export const captureService: CaptureService = {
  allowance: () => fetchAllowance(getSupabase()),
  latestNotebookId: () => fetchLatestNotebookId(getSupabase()),
  send: (input, onReadingSettled) => sendPage(realDeps(onReadingSettled), input),
  preparePhoto: (picture) => preparePhoto(picture, { shrink, remove: (uri) => new File(uri).delete() }),
  discardPhoto,
};
