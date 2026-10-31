import { Directory, Paths } from "expo-file-system";

const FOLDERS = ["scans", "ImageManipulator"];

export function sweepScans(): void {
  for (const name of FOLDERS) {
    try {
      new Directory(Paths.cache, name).delete();
    } catch {
      continue;
    }
  }
}
