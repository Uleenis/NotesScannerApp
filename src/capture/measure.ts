import { File } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { zipSync, type Zippable } from "fflate";

import { discarding, freshFolder, quietly } from "@/export/files";

export type MeasureDeps = {
  read: (uri: string) => Promise<Uint8Array>;
  save: (archive: Uint8Array) => { uri: string; discard: () => void };
  share: (uri: string) => Promise<void>;
  discard: (uri: string) => void;
};

const ARCHIVE_NAME = "scans.zip";

export function measureArchive(pages: Uint8Array[]): Uint8Array {
  const entries: Zippable = {};
  pages.forEach((page, index) => {
    entries[`${String(index + 1).padStart(2, "0")}.jpg`] = [page, { level: 0 }];
  });
  return zipSync(entries);
}

export async function shareMeasure(uris: string[], deps: MeasureDeps): Promise<boolean> {
  try {
    const pages: Uint8Array[] = [];
    for (const uri of uris) {
      pages.push(await deps.read(uri));
    }
    const saved = deps.save(measureArchive(pages));
    try {
      await deps.share(saved.uri);
      return true;
    } catch {
      saved.discard();
      return false;
    }
  } catch {
    return false;
  } finally {
    uris.forEach(deps.discard);
  }
}

export const measureDeps: MeasureDeps = {
  read: (uri) => new File(uri).bytes(),
  save: (archive) => {
    const folder = freshFolder();
    const file = new File(folder, ARCHIVE_NAME);
    file.write(archive);
    return { uri: file.uri, discard: discarding(folder) };
  },
  share: async (uri) => {
    if (!(await isAvailableAsync())) {
      throw new Error("ShareUnavailable");
    }
    await shareAsync(uri, { mimeType: "application/zip", UTI: "public.zip-archive" });
  },
  discard: (uri) => quietly(() => new File(uri).delete()),
};
