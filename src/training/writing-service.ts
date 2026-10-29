import { File } from "expo-file-system";

import { uploadPhotoFile } from "@/capture/api";
import { getSupabase } from "@/lib/supabase";
import { fetchWritingTest, requestCheck, startWritingTest, type Upload } from "./writing-api";
import type { RunDeps } from "./run-writing-test";

const POLL_PAUSE = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function realRunDeps(): RunDeps {
  const client = getSupabase();
  return {
    start: (template) => startWritingTest(client, template),
    upload: (upload: Upload, photoUri) => uploadPhotoFile(client, new File(photoUri), upload.path, upload.token),
    check: (testId) => requestCheck(client, testId),
    read: (testId) => fetchWritingTest(client, testId),
    wait: POLL_PAUSE,
    now: () => Date.now(),
  };
}

export const writingService = {
  deps: realRunDeps,
};

export type WritingService = typeof writingService;
