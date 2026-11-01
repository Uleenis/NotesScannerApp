import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

export const VIEW_FOLDER = "offline-view";

export function writeViewFile(bytes: Uint8Array): File {
  const folder = new Directory(Paths.cache, VIEW_FOLDER);
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${randomUUID()}.jpg`);
  file.create();
  file.write(bytes);
  return file;
}

export function clearViewFiles(): void {
  const folder = new Directory(Paths.cache, VIEW_FOLDER);
  if (folder.exists) {
    folder.delete();
  }
}

export function eraseViewFile(file: File): void {
  try {
    file.delete();
  } catch {
    return;
  }
}
