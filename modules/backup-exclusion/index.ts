import { requireOptionalNativeModule } from "expo";

export type NativeBackupExclusion = {
  exclude(uri: string): boolean;
};

export function backupExclusion(): NativeBackupExclusion | null {
  return requireOptionalNativeModule<NativeBackupExclusion>("BackupExclusion");
}
