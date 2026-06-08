// Singleton better-sqlite3 DB connection.
// WAL mode + foreign keys enabled on open.
// Import this everywhere instead of opening DB directly.

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  // Allow override via env; default to bridge/data/bridge.db
  const envPath = process.env["BRIDGE_DB_PATH"];
  if (envPath) return resolve(envPath);
  return resolve(__dirname, "../../data/bridge.db");
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);

  // Performance + correctness pragmas
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("synchronous = NORMAL"); // safe with WAL

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
