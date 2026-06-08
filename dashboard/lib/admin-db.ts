// admin-db.ts — read-write better-sqlite3 singleton for admin API routes.
// Used only in server-side API routes (rebind/cap/toggle). Never in client.

import Database from "better-sqlite3";
import { resolve } from "path";

const DEFAULT_DB_PATH = resolve(process.cwd(), "../bridge/data/bridge.db");
const DB_PATH = process.env["BRIDGE_DB_PATH"] ?? DEFAULT_DB_PATH;

let _db: Database.Database | null = null;

export function getAdminDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { fileMustExist: true });
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
  }
  return _db;
}
