import { Directory, Paths } from "expo-file-system";

import { VIEW_FOLDER } from "../offline/view";

const FOLDERS = ["scans", "ImageManipulator", "ImagePicker", VIEW_FOLDER];

export function sweepScans(): void {
  for (const name of FOLDERS) {
    try {
      new Directory(Paths.cache, name).delete();
    } catch {
      continue;
    }
  }
}
