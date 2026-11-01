import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
} from "expo-crypto";

import { ascii, concat, toHex } from "./bytes";
import { KEY_BYTES } from "./key";

export const SEAL_BYTES = 12 + 16;

export type StoreKeys = { database: string; photos: AESEncryptionKey };

async function derive(master: Uint8Array, label: string): Promise<Uint8Array> {
  return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, concat(ascii(label), master)));
}

export async function deriveKeys(master: Uint8Array): Promise<StoreKeys> {
  if (master.length !== KEY_BYTES) {
    throw new Error("invalid_key");
  }
  const database = toHex(await derive(master, "notes-scanner/offline/database"));
  const photos = (await AESEncryptionKey.import(await derive(master, "notes-scanner/offline/photos"))) as AESEncryptionKey;
  return { database, photos };
}

export async function seal(plain: Uint8Array, key: AESEncryptionKey, label: string): Promise<Uint8Array> {
  const sealed = await aesEncryptAsync(plain, key, { additionalData: ascii(label) });
  return sealed.combined("bytes");
}

export async function unseal(data: Uint8Array, key: AESEncryptionKey, label: string): Promise<Uint8Array | null> {
  if (data.length <= SEAL_BYTES) {
    return null;
  }
  try {
    return await aesDecryptAsync(AESSealedData.fromCombined(data), key, { additionalData: ascii(label), output: "bytes" });
  } catch {
    return null;
  }
}
