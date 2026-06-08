// Integration smoke test: fixture JSON → filter → dedup → router
// Verifies 1 messages row + 1 RoutedJob emitted with correct fields.
// Uses a temp in-memory DB — no real lark-cli or network calls.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { filterEvent } from "../src/ingest/event-filter.js";
import { dedupMessage } from "../src/ingest/dedup.js";
import { routeMessage, engineQueue } from "../src/ingest/router.js";
import type { RoutedJob } from "../src/types/routed-job.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

const BOT_NAME = "Chanh Quản Gia";

// Real captured fixture
const FIXTURE = {
  type: "im.message.receive_v1",
  event_id: "216596a2e34be01e641d8a09621bf33d",
  timestamp: "1780857477320",
  id: "om_x100b6d6fe69c88a4e1576b6dfdea3c3",
  message_id: "om_x100b6d6fe69c88a4e1576b6dfdea3c3",
  create_time: "1780857477092",
  chat_id: "oc_2d1920f8015432088e8013a9a46a17fa",
  chat_type: "group",
  message_type: "text",
  sender_id: "ou_ac48dc3cecb9bb914f9cca6ee6cfff93",
  content: "@Chanh Quản Gia tính 2+2",
};

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

function seedMinimal(db: Database.Database): number {
  const projectId = Number(
    db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run("cli_smoke", "Smoke Project").lastInsertRowid,
  );
  db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (?, ?, ?)").run(projectId, "smoke-agent", "/agents/smoke");
  return projectId;
}

describe("pipeline smoke — fixture through filter→dedup→router", () => {
  let db: Database.Database;
  const emittedJobs: RoutedJob[] = [];

  before(() => {
    db = makeTestDb();
    seedMinimal(db);
    engineQueue.on("job", (job: RoutedJob) => emittedJobs.push(job));
  });

  after(() => {
    db.close();
  });

  it("fixture passes filter and strips mention correctly", () => {
    const result = filterEvent(FIXTURE, BOT_NAME);
    assert.equal(result.accepted, true);
    assert.equal(result.text, "tính 2+2");
  });

  it("first pass through full pipeline: 1 message row + 1 job", () => {
    const filterResult = filterEvent(FIXTURE, BOT_NAME);
    assert.equal(filterResult.accepted, true);

    const dedup = dedupMessage(db, {
      chatId: filterResult.event.chat_id,
      larkMessageId: filterResult.event.message_id,
      userId: filterResult.event.sender_id,
      content: filterResult.event.content,
    });
    assert.equal(dedup.isNew, true);

    const job = routeMessage(db, {
      chatId: filterResult.event.chat_id,
      userId: filterResult.event.sender_id,
      text: filterResult.text,
      larkMessageId: filterResult.event.message_id,
      eventId: filterResult.event.event_id,
      chatType: filterResult.event.chat_type,
    });

    assert.equal(job.chatId, FIXTURE.chat_id);
    assert.equal(job.userId, FIXTURE.sender_id);
    assert.equal(job.text, "tính 2+2");
    assert.equal(job.larkMessageId, FIXTURE.message_id);
    assert.equal(job.eventId, FIXTURE.event_id);
    assert.equal(job.chatType, "group");
    assert.ok(typeof job.agentId === "number");
    assert.ok(typeof job.projectId === "number");

    // Confirm 1 row in messages
    const msgCount = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM messages")
      .get();
    assert.equal(msgCount?.n, 1);
  });

  it("second pass (redelivery): isNew=false, still 1 messages row, no extra job", () => {
    const jobsBefore = emittedJobs.length;

    const filterResult = filterEvent(FIXTURE, BOT_NAME);
    assert.equal(filterResult.accepted, true);

    const dedup = dedupMessage(db, {
      chatId: filterResult.event.chat_id,
      larkMessageId: filterResult.event.message_id,
      userId: filterResult.event.sender_id,
      content: filterResult.event.content,
    });
    assert.equal(dedup.isNew, false);

    // Simulate index.ts behaviour: skip routing on duplicate
    if (!dedup.isNew) {
      // no route call
    }

    const msgCount = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM messages")
      .get();
    assert.equal(msgCount?.n, 1);
    assert.equal(emittedJobs.length, jobsBefore); // no new job
  });

  it("engineQueue received exactly 1 job total from this pipeline run", () => {
    // Only the first-pass route call should have fired
    assert.equal(emittedJobs.filter((j) => j.larkMessageId === FIXTURE.message_id).length, 1);
  });
});
