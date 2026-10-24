import { File, FileMode, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Allowance } from "@/capture/allowance";
import { getSupabase } from "@/lib/supabase";
import { discarding, freshFolder, sweepExports } from "../files";
import { exportFileName } from "../text";
import {
  planMyData,
  writeMyData,
  type ArchiveIdentity,
  type MyDataPlan,
  type MyDataResult,
  type PhotoSource,
  type PlanResult,
  type SavedArchive,
} from "./archive";
import { openZip } from "./zip";

const SIGNED_URL_SECONDS = 600;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;

type PhotoClient = Pick<SupabaseClient, "storage">;

function* readChunks(file: File): Generator<Uint8Array> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    for (;;) {
      const chunk = handle.readBytes(CHUNK_BYTES);
      if (chunk.length === 0) {
        return;
      }
      yield chunk;
    }
  } finally {
    handle.close();
  }
}

function isJpeg(file: File): boolean {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const head = handle.readBytes(2);
    return head.length === 2 && head[0] === 0xff && head[1] === 0xd8;
  } finally {
    handle.close();
  }
}

function signedUrl(data: unknown): string | null {
  const url = typeof data === "object" && data !== null && "signedUrl" in data ? (data as { signedUrl: unknown }).signedUrl : null;
  return typeof url === "string" ? url : null;
}

export async function fetchPhoto(client: PhotoClient, path: string): Promise<PhotoSource | null> {
  const { data, error } = await client.storage.from("photos").createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) {
    if (/not found/i.test(error.message)) {
      return null;
    }
    throw new Error("The photo could not be loaded.");
  }
  const url = signedUrl(data);
  if (url === null) {
    throw new Error("The photo could not be loaded.");
  }
  const folder = freshFolder("export-photo");
  const dispose = discarding(folder);
  try {
    const file = await File.downloadFileAsync(url, new File(folder, "photo.jpg"));
    if (file.size > MAX_PHOTO_BYTES || !isJpeg(file)) {
      throw new Error("The photo could not be used.");
    }
    return { chunks: () => readChunks(file), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function openArchive(name: string): SavedArchive {
  sweepExports();
  const folder = freshFolder();
  const discard = discarding(folder);
  try {
    const target = new File(folder, `${exportFileName(name, "notes")}.zip`);
    return { sink: openZip(target), uri: target.uri, discard };
  } catch (error) {
    discard();
    throw error;
  }
}

export async function shareArchive(uri: string): Promise<boolean> {
  if (!(await isAvailableAsync())) {
    return false;
  }
  await shareAsync(uri, { mimeType: "application/zip", UTI: "public.zip-archive" });
  return true;
}

export function freeSpace(): number {
  return Paths.availableDiskSpace;
}

export type MyDataContext = { allowance: Allowance | null; fileName: string; readme: string };

export const myDataService = {
  plan: (identity: ArchiveIdentity, control: { cancelled: boolean }): Promise<PlanResult> => planMyData(getSupabase(), identity, control),
  write: (
    plan: MyDataPlan,
    context: MyDataContext,
    control: { cancelled: boolean },
    progress: (done: number, total: number) => void,
  ): Promise<MyDataResult> =>
    writeMyData(
      plan,
      {
        client: getSupabase(),
        open: openArchive,
        photo: (path) => fetchPhoto(getSupabase(), path),
        share: shareArchive,
        freeSpace,
        now: () => new Date(),
        ...context,
      },
      control,
      progress,
    ),
};
