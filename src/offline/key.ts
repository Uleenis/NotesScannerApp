import { getRandomBytesAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { checkedUuid, fromHex, isHexKey, sameBytes, toHex } from "./bytes";

export const KEY_BYTES = 32;

export type StoredKey = { status: "found"; key: Uint8Array } | { status: "absent" } | { status: "unreadable" };

function options(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

function keyName(userId: string): string {
  return `offline-key.${checkedUuid(userId)}`;
}

export async function readKey(userId: string): Promise<StoredKey> {
  const name = keyName(userId);
  let value: string | null;
  try {
    value = await SecureStore.getItemAsync(name, options());
  } catch {
    throw new Error("key_unavailable");
  }
  if (value === null) {
    return { status: "absent" };
  }
  if (!isHexKey(value)) {
    return { status: "unreadable" };
  }
  return { status: "found", key: fromHex(value) };
}

export async function createKey(userId: string): Promise<Uint8Array> {
  const name = keyName(userId);
  const key = await getRandomBytesAsync(KEY_BYTES);
  if (key.length !== KEY_BYTES) {
    throw new Error("key_not_drawn");
  }
  await SecureStore.setItemAsync(name, toHex(key), options());
  const stored = await readKey(userId);
  if (stored.status !== "found" || !sameBytes(stored.key, key)) {
    throw new Error("key_not_stored");
  }
  return key;
}

export async function deleteKey(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(userId), options());
}
