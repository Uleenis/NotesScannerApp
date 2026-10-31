import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";

import { getSupabase } from "@/lib/supabase";
import type { Allowance } from "./allowance";
import { callPrepare, callRead, fetchAllowance, fetchLatestNotebookId, insertPage, markUploaded, uploadPhotoFile } from "./api";
import { PHOTO_QUALITY, preparePhoto, shrinkTarget, type Picture } from "./photo";
import { checkSharpness, decodeJpegGray, sharpnessSize, type Gray, type SharpnessCheck } from "./sharpness";
import { sendPage,type SendDeps, type SendInput, type SendResult } from "./send-page";

const SEND_TIMEOUT_MS = 120_000;

export type CaptureService = {
  allowance: () => Promise<Allowance | null>;
  latestNotebookId: () => Promise<string | null>;
  send: (input: SendInput, onReadingSettled?: () => void) => Promise<SendResult>;
  preparePhoto: (picture: Picture, quarterTurns: number) => Promise<string>;
  discardPhoto: (uri: string) => void;
  checkSharpness: (uri: string) => Promise<SharpnessCheck>;
};

function realDeps(onReadingSettled?: () => void): SendDeps {
  const client = getSupabase();
  return {
    createPage: (notebookId, capturedAt, chapterId) => insertPage(client, notebookId, capturedAt, chapterId),
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

async function saveTurned(uri: string, degrees: number): Promise<string> {
  const loaded = ImageManipulator.manipulate(uri);
  const turned = await (degrees === 0 ? loaded : loaded.rotate(degrees)).renderAsync();
  const images: ImageRef[] = [turned];
  try {
    const target = shrinkTarget(turned.width, turned.height);
    const final = target === null ? turned : await ImageManipulator.manipulate(turned).resize(target).renderAsync();
    images.push(final);
    const saved = await final.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    return saved.uri;
  } finally {
    new Set(images).forEach((image) => image.release());
  }
}

async function decodeForSharpness(uri: string): Promise<Gray | null> {
  const loaded = ImageManipulator.manipulate(uri);
  const full = await loaded.renderAsync();
  const images: ImageRef[] = [full];
  let copy: string | null = null;
  try {
    const target = sharpnessSize(full.width, full.height);
    const small = target === null ? full : await ImageManipulator.manipulate(full).resize(target).renderAsync();
    images.push(small);
    copy = (await small.saveAsync({ format: SaveFormat.JPEG, compress: 1 })).uri;
    return decodeJpegGray(await new File(copy).bytes());
  } finally {
    new Set(images).forEach((image) => image.release());
    if (copy !== null) {
      discardPhoto(copy);
    }
  }
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
  preparePhoto: (picture, quarterTurns) => preparePhoto(picture, quarterTurns, { save: saveTurned }),
  discardPhoto,
  checkSharpness: (uri) => checkSharpness(uri, { decode: decodeForSharpness }),
};
