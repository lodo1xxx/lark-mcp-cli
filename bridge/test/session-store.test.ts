// Tests: session-store.ts — upsert then get; message_count increments

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSession, upsertSession } from "../src/engine/session-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Strip top-level PRAGMAs (FK enforcement still set above)
  const ddl = SCHEMA
    .split("\n")
    .filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);
  return db;
}

function seedProject(db: Database.Database): { projectId: number; agentId: number } {
  const projectId = Number(
    db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run("cli_test_ss", "SS Project").lastInsertRowid,
  );
  const agentId = Number(
    db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (?, ?, ?)").run(projectId, "agent-a", "/agents/a").lastInsertRowid,
  );
  return { projectId, agentId };
}

describe("session-store", () => {
  let db: Database.Database;
  let seed: { projectId: number; agentId: number };

  before(() => {
    db = makeTestDb();
    seed = seedProject(db);
  });

  after(() => db.close());

  it("getSession returns undefined for unknown chat_id", () => {
    const row = getSession(db, "chat_nonexistent");
    assert.equal(row, undefined);
  });

  it("upsertSession inserts a new session row", () => {
    upsertSession(db, "chat_001", seed.projectId, seed.agentId, "claude-sess-aaa");
    const row = getSession(db, "chat_001");
    assert.ok(row, "row should exist");
    assert.equal(row.claude_session_id, "claude-sess-aaa");
    assert.equal(row.chat_id, "chat_001");
    assert.equal(row.message_count, 1);
  });

  it("upsertSession updates claude_session_id on conflict", () => {
    upsertSession(db, "chat_001", seed.projectId, seed.agentId, "claude-sess-bbb");
    const row = getSession(db, "chat_001");
    assert.equal(row?.claude_session_id, "claude-sess-bbb");
  });

  it("upsertSession increments message_count on each call", () => {
    // chat_001 already has count=2 after two upserts
    upsertSession(db, "chat_001", seed.projectId, seed.agentId, "claude-sess-bbb");
    const row = getSession(db, "chat_001");
    assert.equal(row?.message_count, 3);
  });

  it("upsertSession handles multiple independent chats", () => {
    upsertSession(db, "chat_002", seed.projectId, seed.agentId, "claude-sess-ccc");
    const row1 = getSession(db, "chat_001");
    const row2 = getSession(db, "chat_002");
    assert.equal(row2?.claude_session_id, "claude-sess-ccc");
    assert.equal(row2?.message_count, 1);
    assert.equal(row1?.message_count, 3); // unchanged
  });
});
