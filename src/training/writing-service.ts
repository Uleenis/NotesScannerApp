import { File } from "expo-file-system";

import { uploadPhoto } from "@/capture/api";
import { getSupabase } from "@/lib/supabase";
import { fetchWritingTest, requestCheck, startWritingTest, type Upload } from "./writing-api";
import type { RunDeps } from "./run-writing-test";

const POLL_PAUSE = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function realRunDeps(): RunDeps {
  const client = getSupabase();
  return {
    start: (template) => startWritingTest(client, template),
    upload: async (upload: Upload, photoUri) => {
      let bytes: Uint8Array;
      try {
        bytes = await new File(photoUri).bytes();
      } catch {
        return "failed";
      }
      return uploadPhoto(client, upload.path, upload.token, bytes);
    },
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
