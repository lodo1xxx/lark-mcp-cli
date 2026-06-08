// Tests: dedup.ts — INSERT OR IGNORE + isNew logic
// Uses node:test with an in-memory SQLite DB (no file I/O).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dedupMessage } from "../src/ingest/dedup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Strip PRAGMA lines then exec the whole DDL in one call (avoids splitting on comment semicolons)
  const ddl = SCHEMA
    .split("\n")
    .filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);
  return db;
}

const MSG = {
  chatId: "oc_abc123",
  larkMessageId: "om_unique_001",
  userId: "ou_sender_xyz",
  content: "@Bot hello world",
};

describe("dedupMessage", () => {
  let db: Database.Database;

  before(() => {
    db = makeTestDb();
  });

  after(() => {
    db.close();
  });

  it("returns isNew=true on first insert", () => {
    const result = dedupMessage(db, MSG);
    assert.equal(result.isNew, true);
    assert.ok(result.messageId > 0);
  });

  it("returns isNew=false on duplicate lark_message_id", () => {
    const result = dedupMessage(db, MSG);
    assert.equal(result.isNew, false);
    assert.ok(result.messageId > 0);
  });

  it("only 1 row in messages table after two inserts of same id", () => {
    const count = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM messages WHERE lark_message_id = ?")
      .get(MSG.larkMessageId);
    assert.equal(count?.n, 1);
  });

  it("different lark_message_id inserts a new row", () => {
    const result = dedupMessage(db, { ...MSG, larkMessageId: "om_unique_002" });
    assert.equal(result.isNew, true);
    assert.ok(result.messageId > 0);
  });

  it("total rows = 2 after two distinct messages", () => {
    const count = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM messages")
      .get();
    assert.equal(count?.n, 2);
  });
});
