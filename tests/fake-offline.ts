import { DatabaseSync } from "node:sqlite";

const subtle = globalThis.crypto.subtle;

function randomBytes(count: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

export function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function joinBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export const fakeFiles = new Map<string, Uint8Array>();
export const fakeDirectories = new Set<string>();
export const fakeDatabases = new Map<string, { key: string | null; userVersion: number; tables: string[]; inner: DatabaseSync }>();
export const fakeOpened: FakeDatabase[] = [];
export const fakeSqlite = { cipher: true, probeError: null as string | null };
export const fakeFaults = { directoryDelete: false, write: false };
export const fakeSecure = {
  values: new Map<string, string>(),
  getFails: 0,
  calls: [] as { action: string; key: string; options: unknown }[],
};
export const fakeRandom = { calls: 0 };

export function resetOffline(): void {
  fakeFiles.clear();
  fakeDirectories.clear();
  fakeDatabases.clear();
  fakeOpened.length = 0;
  fakeSqlite.cipher = true;
  fakeSqlite.probeError = null;
  fakeFaults.directoryDelete = false;
  fakeFaults.write = false;
  fakeSecure.values.clear();
  fakeSecure.getFails = 0;
  fakeSecure.calls.length = 0;
  fakeRandom.calls = 0;
}

function joinUri(parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri))
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

function parentOf(uri: string): string {
  return uri.slice(0, uri.lastIndexOf("/"));
}

function removeUnder(uri: string): void {
  for (const map of [fakeFiles, fakeDatabases] as Map<string, unknown>[]) {
    for (const key of [...map.keys()]) {
      if (key.startsWith(`${uri}/`)) {
        map.delete(key);
      }
    }
  }
  for (const key of [...fakeDirectories]) {
    if (key === uri || key.startsWith(`${uri}/`)) {
      fakeDirectories.delete(key);
    }
  }
}

class FakeDirectory {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = joinUri(parts);
  }
  get exists(): boolean {
    return fakeDirectories.has(this.uri);
  }
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void {
    if (this.exists) {
      if (options?.idempotent !== true) {
        throw new Error("directory exists");
      }
      return;
    }
    if (!fakeDirectories.has(parentOf(this.uri)) && options?.intermediates !== true) {
      throw new Error("no parent");
    }
    let uri = this.uri;
    while (uri.includes("/") && !uri.endsWith(":/")) {
      fakeDirectories.add(uri);
      uri = parentOf(uri);
    }
  }
  delete(): void {
    if (!this.exists) {
      throw new Error("missing directory");
    }
    if (fakeFaults.directoryDelete) {
      throw new Error("busy");
    }
    removeUnder(this.uri);
  }
  list(): (FakeDirectory | FakeFile)[] {
    const files = [...fakeFiles.keys()].filter((uri) => parentOf(uri) === this.uri).map((uri) => new FakeFile(uri));
    const directories = [...fakeDirectories].filter((uri) => parentOf(uri) === this.uri).map((uri) => new FakeDirectory(uri));
    return [...directories, ...files];
  }
}

class FakeFile {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = joinUri(parts);
  }
  get exists(): boolean {
    return fakeFiles.has(this.uri);
  }
  get size(): number {
    return fakeFiles.get(this.uri)?.length ?? 0;
  }
  create(options?: { overwrite?: boolean }): void {
    if (!fakeDirectories.has(parentOf(this.uri))) {
      throw new Error("no parent");
    }
    if (this.exists && options?.overwrite !== true) {
      throw new Error("file exists");
    }
    fakeFiles.set(this.uri, new Uint8Array(0));
  }
  write(content: Uint8Array | string): void {
    if (!this.exists) {
      throw new Error("missing file");
    }
    if (fakeFaults.write) {
      fakeFiles.set(this.uri, new Uint8Array(3));
      throw new Error("no space left");
    }
    fakeFiles.set(this.uri, typeof content === "string" ? textBytes(content) : new Uint8Array(content));
  }
  async bytes(): Promise<Uint8Array> {
    const content = fakeFiles.get(this.uri);
    if (content === undefined) {
      throw new Error("missing file");
    }
    return new Uint8Array(content);
  }
  delete(): void {
    if (!this.exists) {
      throw new Error("missing file");
    }
    fakeFiles.delete(this.uri);
  }
}

export const fileSystem = {
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { document: new FakeDirectory("file:///docs"), cache: new FakeDirectory("file:///cache") },
};

const KEY_PRAGMA = /^PRAGMA key = "x'([0-9a-f]{64})'"$/;
const USER_VERSION_SET = /^PRAGMA user_version = (\d+)$/;
const CREATE_TABLE = /create table (\w+)/g;
const PRAGMA = /^\s*PRAGMA/i;

function bindings(params: unknown[]): never[] {
  const list = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return list as never[];
}

export class FakeDatabase {
  path: string;
  key: string | null = null;
  statements: string[] = [];
  closed = false;
  constructor(path: string) {
    this.path = path;
  }
  private file() {
    const found = fakeDatabases.get(this.path);
    if (found === undefined) {
      const created = { key: this.key, userVersion: 0, tables: [] as string[], inner: new DatabaseSync(":memory:") };
      fakeDatabases.set(this.path, created);
      fakeFiles.set(this.path, this.key === null ? textBytes("SQLite format 3") : randomBytes(64));
      return created;
    }
    if (found.key !== this.key) {
      throw new Error("file is not a database");
    }
    return found;
  }
  private record(sql: string): void {
    if (this.closed) {
      throw new Error("closed");
    }
    this.statements.push(sql);
  }
  async execAsync(sql: string): Promise<void> {
    this.record(sql);
    const key = KEY_PRAGMA.exec(sql);
    if (key !== null) {
      if (this.statements.length > 1) {
        throw new Error("key after use");
      }
      if (fakeSqlite.cipher) {
        this.key = key[1];
      }
      return;
    }
    const file = this.file();
    const version = USER_VERSION_SET.exec(sql);
    if (version !== null) {
      file.userVersion = Number(version[1]);
    }
    for (const match of sql.matchAll(CREATE_TABLE)) {
      file.tables.push(match[1]);
    }
    if (!PRAGMA.test(sql)) {
      file.inner.exec(sql);
    }
  }
  async runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    this.record(sql);
    const result = this.file().inner.prepare(sql).run(...bindings(params));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    this.record(sql);
    return this.file().inner.prepare(sql).all(...bindings(params)) as T[];
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    this.record(sql);
    if (sql === "PRAGMA cipher_version") {
      return (fakeSqlite.cipher ? { cipher_version: "4.10.0 community" } : null) as T | null;
    }
    const file = this.file();
    if (sql === "PRAGMA user_version") {
      return { user_version: file.userVersion } as T;
    }
    if (sql === "select count(*) as count from sqlite_master") {
      if (fakeSqlite.probeError !== null) {
        const message = fakeSqlite.probeError;
        fakeSqlite.probeError = null;
        throw new Error(message);
      }
      return { count: file.tables.length } as T;
    }
    const row = file.inner.prepare(sql).get(...bindings(params));
    return (row ?? null) as T | null;
  }
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    const { inner } = this.file();
    inner.exec("begin");
    try {
      await task();
    } catch (error) {
      inner.exec("rollback");
      throw error;
    }
    inner.exec("commit");
  }
  async closeAsync(): Promise<void> {
    this.closed = true;
  }
}

export const sqlite = {
  openDatabaseAsync: async (name: string, options: unknown, directory: string) => {
    const folder = directory.replace(/\/+$/, "");
    new FakeDirectory(folder).create({ intermediates: true, idempotent: true });
    const database = new FakeDatabase(`${folder}/${name}`);
    fakeOpened.push(database);
    return database;
  },
};

class FakeKey {
  raw: Uint8Array<ArrayBuffer>;
  constructor(raw: Uint8Array<ArrayBuffer>) {
    this.raw = raw;
  }
  static async import(bytes: Uint8Array): Promise<FakeKey> {
    if (bytes.length !== 32) {
      throw new Error("key size");
    }
    return new FakeKey(new Uint8Array(bytes));
  }
}

class FakeSealed {
  data: Uint8Array<ArrayBuffer>;
  constructor(data: Uint8Array<ArrayBuffer>) {
    this.data = data;
  }
  static fromCombined(data: Uint8Array): FakeSealed {
    return new FakeSealed(new Uint8Array(data));
  }
  async combined(): Promise<Uint8Array> {
    return new Uint8Array(this.data);
  }
}

export const crypto = {
  AESEncryptionKey: FakeKey,
  AESSealedData: FakeSealed,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  randomUUID: () => globalThis.crypto.randomUUID(),
  getRandomBytesAsync: async (count: number) => {
    fakeRandom.calls += 1;
    return randomBytes(count);
  },
  digest: async (algorithm: string, data: Uint8Array<ArrayBuffer>) => {
    if (algorithm !== "SHA-256") {
      throw new Error("algorithm");
    }
    return subtle.digest("SHA-256", data);
  },
  aesEncryptAsync: async (plain: Uint8Array<ArrayBuffer>, key: FakeKey, options?: { additionalData?: Uint8Array<ArrayBuffer> }) => {
    const iv = randomBytes(12);
    const raw = await subtle.importKey("raw", key.raw, "AES-GCM", false, ["encrypt"]);
    const body = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: options?.additionalData, tagLength: 128 }, raw, plain);
    return new FakeSealed(joinBytes(iv, new Uint8Array(body)));
  },
  aesDecryptAsync: async (
    sealed: FakeSealed,
    key: FakeKey,
    options?: { additionalData?: Uint8Array<ArrayBuffer>; output?: string },
  ) => {
    if (options?.output !== "bytes") {
      throw new Error("output");
    }
    const raw = await subtle.importKey("raw", key.raw, "AES-GCM", false, ["decrypt"]);
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: sealed.data.slice(0, 12), additionalData: options.additionalData, tagLength: 128 },
      raw,
      sealed.data.slice(12),
    );
    return new Uint8Array(plain);
  },
};

export const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: async (key: string, options?: unknown) => {
    fakeSecure.calls.push({ action: "get", key, options });
    if (fakeSecure.getFails > 0) {
      fakeSecure.getFails -= 1;
      throw new Error("keystore");
    }
    return fakeSecure.values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, options?: unknown) => {
    fakeSecure.calls.push({ action: "set", key, options });
    fakeSecure.values.set(key, value);
  },
  deleteItemAsync: async (key: string, options?: unknown) => {
    fakeSecure.calls.push({ action: "delete", key, options });
    fakeSecure.values.delete(key);
  },
};
