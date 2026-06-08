// Integration smoke: RoutedJob → queue → runner → parser → persist
// Uses a TEMP in-memory DB and ONE real claude call (tiny prompt: "Reply with: pong").
// Asserts: returned text contains "pong", sessions row exists, no quota_usage row
// (user not registered yet — phase-06 adds user upsert; see engine/index.ts comment).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEngineJob, resetQueue } from "../src/engine/index.js";
import type { RoutedJob } from "../src/types/routed-job.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ddl = SCHEMA
    .split("\n")
    .filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);
  return db;
}

function seedSmoke(db: Database.Database): { projectId: number; agentId: number; messageId: number } {
  const projectId = Number(
    db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run("cli_smoke", "Smoke Project").lastInsertRowid,
  );
  const agentId = Number(
    db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (?, ?, ?)").run(projectId, "smoke-agent", "/agents/smoke").lastInsertRowid,
  );
  // Pre-insert the inbound message row (as phase-02 dedup would do)
  const messageId = Number(
    db.prepare(
      `INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content)
       VALUES (?, ?, 'inbound', ?, ?)`,
    ).run("chat_smoke_test", "om_smoke_001", "ou_smoke_user", "Reply with: pong").lastInsertRowid,
  );
  return { projectId, agentId, messageId };
}

const SMOKE_JOB: RoutedJob = {
  chatId: "chat_smoke_test",
  projectId: 0, // set in before()
  agentId: 0,
  userId: "ou_smoke_user",
  text: "Reply with: pong",
  larkMessageId: "om_smoke_001",
  eventId: "evt_smoke_001",
  chatType: "p2p",
};

describe("engine integration smoke", { timeout: 60_000 }, () => {
  let db: Database.Database;
  let job: RoutedJob;
  const CLAUDE_BINARY = process.env["CLAUDE_BINARY"] ?? "claude";

  before(() => {
    db = makeTestDb();
    const seed = seedSmoke(db);
    job = { ...SMOKE_JOB, projectId: seed.projectId, agentId: seed.agentId };
    resetQueue();
  });

  after(() => {
    db.close();
    resetQueue();
  });

  it("returns text containing 'pong'", async () => {
    const result = await runEngineJob(db, job, {
      binary: CLAUDE_BINARY,
      concurrency: 1,
      timeoutMs: 60_000,
      defaultModel: undefined,
    });
    assert.ok(
      result.text.toLowerCase().includes("pong"),
      `Expected reply to contain 'pong', got: "${result.text}"`,
    );
  });

  it("persists a sessions row with claude_session_id", () => {
    const row = db
      .prepare<[string], { claude_session_id: string | null; message_count: number }>(
        `SELECT claude_session_id, message_count FROM sessions WHERE chat_id = ?`,
      )
      .get("chat_smoke_test");
    assert.ok(row, "sessions row must exist");
    assert.ok(row.claude_session_id, "claude_session_id must be non-null");
    assert.ok(row.message_count >= 1);
  });

  it("updates messages.claude_session_id on the inbound row", () => {
    const row = db
      .prepare<[string], { claude_session_id: string | null }>(
        `SELECT claude_session_id FROM messages WHERE lark_message_id = ?`,
      )
      .get("om_smoke_001");
    assert.ok(row?.claude_session_id, "messages row should have claude_session_id set");
  });

  it("usage tokens are positive numbers in the result", async () => {
    // Re-run with a follow-up to also verify resume carries context
    const followUp: RoutedJob = {
      ...job,
      text: "What word did I just ask you to reply with?",
      larkMessageId: "om_smoke_002",
      eventId: "evt_smoke_002",
    };
    // insert the follow-up message row
    db.prepare(
      `INSERT OR IGNORE INTO messages (chat_id, lark_message_id, direction, user_id, content)
       VALUES (?, ?, 'inbound', ?, ?)`,
    ).run("chat_smoke_test", "om_smoke_002", "ou_smoke_user", followUp.text);

    const result = await runEngineJob(db, followUp, {
      binary: CLAUDE_BINARY,
      concurrency: 1,
      timeoutMs: 60_000,
    });
    assert.ok(result.usage.inputTokens > 0, "inputTokens should be > 0");
    assert.ok(result.usage.outputTokens > 0, "outputTokens should be > 0");
    assert.ok(result.notionalCostUsd >= 0);
  });
});
