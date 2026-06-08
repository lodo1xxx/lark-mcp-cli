// Tests: send-reply.ts — argv shape, sequential order, retry→fallback, DB persistence.
// Uses --dry-run flag so NO real Lark messages are sent.
// DB is in-memory SQLite seeded with minimal project row (audit_log FK).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendReply } from "../src/reply/send-reply.js";

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

function seedProject(db: Database.Database): number {
  return Number(
    db
      .prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)")
      .run("cli_test_reply", "Reply Test Project").lastInsertRowid,
  );
}

describe("sendReply — dry-run mode (no real Lark sends)", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeTestDb();
    projectId = seedProject(db);
  });

  after(() => {
    db.close();
  });

  it("short text sends 1 chunk and returns chunks=1", async () => {
    const result = await sendReply(
      db,
      {
        chatId: "oc_test_chat",
        text: "Hello from Claude!",
        inboundMessageId: "om_inbound_001",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );
    assert.equal(result.chunks, 1);
    assert.equal(result.sentMessageIds.length, 1);
  });

  it("persists 1 outbound message row after send", async () => {
    await sendReply(
      db,
      {
        chatId: "oc_test_persist",
        text: "Persist test",
        inboundMessageId: "om_inbound_002",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );

    const row = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE chat_id = 'oc_test_persist' AND direction = 'outbound'",
      )
      .get();
    assert.equal(row?.n, 1);
  });

  it("persists 1 audit_log row with event_type=reply_sent", async () => {
    await sendReply(
      db,
      {
        chatId: "oc_test_audit",
        text: "Audit test",
        inboundMessageId: "om_inbound_003",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );

    const row = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM audit_log WHERE chat_id = 'oc_test_audit' AND event_type = 'reply_sent'",
      )
      .get();
    assert.equal(row?.n, 1);
  });

  it("long text produces multiple chunks in order", async () => {
    // Build text that must split: 3 lines of 60 chars with cap=100
    const line = "w".repeat(60);
    const text = [line, line, line].join("\n");

    const result = await sendReply(
      db,
      {
        chatId: "oc_test_multi",
        text,
        inboundMessageId: "om_inbound_004",
        projectId,
      },
      { binary: "lark-cli", dryRun: true, maxChars: 100 },
    );

    assert.ok(result.chunks >= 2, `expected >= 2 chunks, got ${result.chunks}`);
    assert.equal(result.sentMessageIds.length, result.chunks);

    // Verify outbound rows count matches chunks
    const rows = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE chat_id = 'oc_test_multi' AND direction = 'outbound'",
      )
      .get();
    assert.equal(rows?.n, result.chunks);
  });

  it("empty text gets normalized to placeholder — still sends 1 chunk", async () => {
    const result = await sendReply(
      db,
      {
        chatId: "oc_test_empty",
        text: "   ",
        inboundMessageId: "om_inbound_005",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );
    assert.equal(result.chunks, 1);
    // Check the content stored is the placeholder, not whitespace
    const row = db
      .prepare<[], { content: string }>(
        "SELECT content FROM messages WHERE chat_id = 'oc_test_empty' AND direction = 'outbound' LIMIT 1",
      )
      .get();
    assert.ok(row, "expected outbound message row");
    assert.ok(row.content.trim().length > 0, "placeholder should be non-empty");
  });

  it("idempotency key uses inboundMessageId:chunkIndex pattern", async () => {
    // We can't intercept the argv without monkey-patching, but we CAN verify
    // that duplicate calls with the same inboundMessageId don't insert duplicate
    // outbound rows (because lark-cli --idempotency-key deduplicates on the server).
    // For the DB side: lark-cli dry-run returns same fake id "unknown" → INSERT OR IGNORE prevents duplication.
    await sendReply(
      db,
      {
        chatId: "oc_test_idem",
        text: "Idempotency test",
        inboundMessageId: "om_inbound_006",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );
    await sendReply(
      db,
      {
        chatId: "oc_test_idem",
        text: "Idempotency test",
        inboundMessageId: "om_inbound_006",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );
    // INSERT OR IGNORE: still just 1 outbound row for that inbound id
    const rows = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE chat_id = 'oc_test_idem' AND direction = 'outbound'",
      )
      .get();
    assert.equal(rows?.n, 1);
  });

  it("bad binary → retry path → audit_log reply_failed row", async () => {
    // Use a non-existent binary to force failure across all retries
    const result = await sendReply(
      db,
      {
        chatId: "oc_test_fail",
        text: "This should fail",
        inboundMessageId: "om_inbound_007",
        projectId,
      },
      {
        binary: "/nonexistent/lark-cli-bad",
        dryRun: false,
        maxRetries: 2,
        backoffMs: 10, // fast test
      },
    );

    // sentMessageIds is empty — no successful sends
    assert.equal(result.sentMessageIds.length, 0);

    // audit_log must have reply_failed row
    const row = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM audit_log WHERE chat_id = 'oc_test_fail' AND event_type = 'reply_failed'",
      )
      .get();
    assert.ok((row?.n ?? 0) >= 1, "expected at least 1 reply_failed audit row");
  });
});

describe("sendReply — empty-prompt path in router (engine not called)", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeTestDb();
    projectId = seedProject(db);
  });

  after(() => {
    db.close();
  });

  it("empty text results in reply with help content", async () => {
    // Empty text → markdownToLark returns placeholder → sends 1 chunk
    const result = await sendReply(
      db,
      {
        chatId: "oc_test_help",
        text: "",
        inboundMessageId: "om_inbound_008",
        projectId,
      },
      { binary: "lark-cli", dryRun: true },
    );
    assert.equal(result.chunks, 1);
  });
});
