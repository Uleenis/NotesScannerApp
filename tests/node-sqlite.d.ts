declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
      all(...params: Value[]): unknown[];
      get(...params: Value[]): unknown;
    };
  }
}
