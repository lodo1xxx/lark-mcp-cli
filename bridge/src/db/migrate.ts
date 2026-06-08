// Idempotent migration runner.
// Guards via user_version: if 0 → apply schema.sql → set version to 1.
// Safe to call on every daemon boot; re-running is a clean no-op.
//
// Uses db.exec() for multi-statement DDL (handles comments + semicolons correctly).
// Pragmas are handled by client.ts on DB open, so schema.sql PRAGMAs are skipped here.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;
const SCHEMA_PATH = resolve(__dirname, "schema.sql");

function getCurrentVersion(): number {
  const db = getDb();
  const row = db.pragma("user_version", { simple: true });
  return typeof row === "number" ? row : 0;
}

/** Strip PRAGMA lines from SQL — pragmas are already applied by client.ts on open. */
function stripPragmas(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
}

function applySchema(): void {
  const db = getDb();
  const rawSql = readFileSync(SCHEMA_PATH, "utf-8");
  const ddlSql = stripPragmas(rawSql);

  // db.exec() handles multi-statement SQL with comments correctly
  db.exec(ddlSql);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export function migrate(): void {
  const current = getCurrentVersion();
  if (current >= SCHEMA_VERSION) {
    console.log(`[migrate] DB already at version ${current} — skipping.`);
    return;
  }
  console.log(`[migrate] Applying schema v${SCHEMA_VERSION}…`);
  applySchema();
  console.log(`[migrate] Done. DB now at version ${SCHEMA_VERSION}.`);
}

// Run directly: tsx src/db/migrate.ts
const thisFile = fileURLToPath(import.meta.url);
const argFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (thisFile === argFile) {
  migrate();
  closeDb(); // flush WAL before exit
  process.exit(0);
}
