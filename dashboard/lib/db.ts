// db.ts — read-only better-sqlite3 singleton over bridge.db.
// WAL mode makes concurrent reads safe alongside the daemon's writes.

import Database from "better-sqlite3";
import { resolve } from "path";

const DEFAULT_DB_PATH = resolve(process.cwd(), "../bridge/data/bridge.db");
const DB_PATH = process.env["BRIDGE_DB_PATH"] ?? DEFAULT_DB_PATH;

let _db: Database.Database | null = null;

export function getReadDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}
