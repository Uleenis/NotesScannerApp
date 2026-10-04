export type SecureValueStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

export type SessionStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export const CHUNK_SIZE = 600;

const HIGH_SURROGATE = /[\uD800-\uDBFF]/;

function split(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + CHUNK_SIZE, value.length);
    if (end < value.length && HIGH_SURROGATE.test(value[end - 1])) {
      end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

function countKey(key: string): string {
  return `${key}.count`;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function storedCount(store: SecureValueStore, key: string): Promise<number> {
  const raw = await store.getItemAsync(countKey(key));
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function removeChunksFrom(store: SecureValueStore, key: string, from: number, to: number): Promise<void> {
  for (let index = from; index < to; index += 1) {
    await store.deleteItemAsync(chunkKey(key, index));
  }
}

export function createChunkedStorage(store: SecureValueStore): SessionStorage {
  return {
    async getItem(key) {
      const count = await storedCount(store, key);
      if (count === 0) {
        return null;
      }
      let value = "";
      for (let index = 0; index < count; index += 1) {
        const chunk = await store.getItemAsync(chunkKey(key, index));
        if (chunk === null) {
          return null;
        }
        value += chunk;
      }
      return value;
    },
    async setItem(key, value) {
      const previous = await storedCount(store, key);
      const chunks = split(value);
      for (let index = 0; index < chunks.length; index += 1) {
        await store.setItemAsync(chunkKey(key, index), chunks[index]);
      }
      await store.setItemAsync(countKey(key), String(chunks.length));
      await removeChunksFrom(store, key, chunks.length, previous);
    },
    async removeItem(key) {
      const count = await storedCount(store, key);
      await store.deleteItemAsync(countKey(key));
      await removeChunksFrom(store, key, 0, count);
    },
  };
}
