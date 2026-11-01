import type { Directory } from "expo-file-system";
import { Platform } from "react-native";

import { backupExclusion } from "../../modules/backup-exclusion";

export function excludeFromBackup(folder: Directory): void {
  if (Platform.OS === "android") {
    return;
  }
  const native = Platform.OS === "ios" ? backupExclusion() : null;
  if (native === null || native.exclude(folder.uri) !== true) {
    throw new Error("backup_exclusion_failed");
  }
}
