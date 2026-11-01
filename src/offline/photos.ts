import type { AESEncryptionKey } from "expo-crypto";
import { Directory, File } from "expo-file-system";

import { checkedUuid, isUuid } from "./bytes";
import { SEAL_BYTES, seal, unseal } from "./cipher";

export const PHOTO_BYTES_MAX = 64 * 1024 * 1024;

export type PhotoKind = "pages" | "queue";

export type OpenedPhoto = { status: "ok"; bytes: Uint8Array } | { status: "missing" } | { status: "refused" };

export type SealedPhotos = {
  save(id: string, bytes: Uint8Array): Promise<void>;
  open(id: string): Promise<OpenedPhoto>;
  remove(id: string): void;
  list(): string[];
};

export function photoFolder(account: Directory, kind: PhotoKind): Directory {
  return new Directory(account, kind);
}

export function countPhotos(account: Directory, kind: PhotoKind): number {
  const folder = photoFolder(account, kind);
  if (!folder.exists) {
    return 0;
  }
  return folder.list().filter((entry) => entry instanceof File).length;
}

export function sealedPhotos(
  account: Directory,
  kind: PhotoKind,
  key: AESEncryptionKey,
  isOpen: () => boolean,
): SealedPhotos {
  const folder = photoFolder(account, kind);
  const file = (id: string) => {
    if (!isOpen()) {
      throw new Error("store_closed");
    }
    return new File(folder, `${checkedUuid(id)}.bin`);
  };
  const label = (id: string) => `${kind}:${id}`;
  return {
    async save(id, bytes) {
      const target = file(id);
      if (bytes.length < 1 || bytes.length > PHOTO_BYTES_MAX) {
        throw new Error("photo_size");
      }
      const sealed = await seal(bytes, key, label(id));
      if (!isOpen()) {
        throw new Error("store_closed");
      }
      try {
        folder.create({ intermediates: true, idempotent: true });
        target.create({ overwrite: true });
        target.write(sealed);
      } catch (error) {
        if (target.exists) {
          target.delete();
        }
        throw error;
      }
    },
    async open(id) {
      const target = file(id);
      if (!target.exists) {
        return { status: "missing" };
      }
      if (target.size <= SEAL_BYTES || target.size > PHOTO_BYTES_MAX + SEAL_BYTES) {
        return { status: "refused" };
      }
      const plain = await unseal(await target.bytes(), key, label(id));
      return plain === null ? { status: "refused" } : { status: "ok", bytes: plain };
    },
    remove(id) {
      const target = file(id);
      if (target.exists) {
        target.delete();
      }
    },
    list() {
      if (!isOpen()) {
        throw new Error("store_closed");
      }
      if (!folder.exists) {
        return [];
      }
      return folder
        .list()
        .filter((entry) => entry instanceof File)
        .map((entry) => entry.uri.slice(entry.uri.lastIndexOf("/") + 1).replace(/\.bin$/, ""))
        .filter(isUuid);
    },
  };
}
