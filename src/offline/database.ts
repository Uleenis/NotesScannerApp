import type { Directory } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { isHexKey } from "./bytes";

export const DATABASE_NAME = "store.db";

const MIGRATIONS: readonly string[] = [
  `create table notebooks (id text primary key not null, data text not null);
create table chapters (id text primary key not null, notebook_id text not null, data text not null);
create index chapters_notebook on chapters (notebook_id);
create table pages (id text primary key not null, notebook_id text not null, chapter_id text, data text not null);
create index pages_notebook on pages (notebook_id, chapter_id);
create table page_alerts (page_id text primary key not null, data text not null);
create table page_renderings (page_id text primary key not null, data text not null);
create table known_limit (id integer primary key not null check (id = 1), data text not null, read_at text not null);
create table queue (id text primary key not null, rank integer not null unique, data text not null);
create table photos (page_id text primary key not null, bytes integer not null check (bytes > 0), opened_at integer not null);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export class StoreUnreadable extends Error {
  constructor() {
    super("store_unreadable");
  }
}

async function migrate(database: SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  if (!Number.isInteger(current) || current < 0 || current > SCHEMA_VERSION) {
    throw new StoreUnreadable();
  }
  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(MIGRATIONS[version]);
      await database.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export async function openDatabase(folder: Directory, key: string): Promise<SQLiteDatabase> {
  if (!isHexKey(key)) {
    throw new Error("invalid_key");
  }
  folder.create({ intermediates: true, idempotent: true });
  const database = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true }, folder.uri);
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const cipher = await database.getFirstAsync<{ cipher_version?: unknown }>("PRAGMA cipher_version");
    if (typeof cipher?.cipher_version !== "string" || cipher.cipher_version.length === 0) {
      throw new Error("cipher_missing");
    }
    try {
      await database.getFirstAsync("select count(*) as count from sqlite_master");
    } catch {
      throw new StoreUnreadable();
    }
    await database.execAsync("PRAGMA temp_store = MEMORY");
    await migrate(database);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}
