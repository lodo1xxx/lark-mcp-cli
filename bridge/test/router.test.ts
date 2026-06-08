// Tests: router.ts — chat_binding lookup + default agent fallback
// Uses node:test with an in-memory SQLite DB seeded with test data.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routeMessage, engineQueue } from "../src/ingest/router.js";
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

function seedTestData(db: Database.Database): { projectId: number; agentId: number; boundAgentId: number } {
  // Insert project
  const projectId = Number(
    db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run("cli_test", "Test Project").lastInsertRowid,
  );

  // Insert default agent (id will be lowest)
  const agentId = Number(
    db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (?, ?, ?)").run(projectId, "default-agent", "/agents/default").lastInsertRowid,
  );

  // Insert a second agent for a specific chat binding
  const boundAgentId = Number(
    db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (?, ?, ?)").run(projectId, "bound-agent", "/agents/bound").lastInsertRowid,
  );

  // Bind the second agent to a specific chat
  db.prepare("INSERT INTO chat_bindings (project_id, chat_id, agent_id) VALUES (?, ?, ?)").run(projectId, "oc_bound_chat", boundAgentId);

  return { projectId, agentId, boundAgentId };
}

const BASE_INPUT = {
  userId: "ou_sender",
  text: "tính 2+2",
  larkMessageId: "om_router_001",
  eventId: "evt_001",
  chatType: "group",
};

describe("routeMessage", () => {
  let db: Database.Database;
  let seed: ReturnType<typeof seedTestData>;
  const jobs: RoutedJob[] = [];

  before(() => {
    db = makeTestDb();
    seed = seedTestData(db);
    engineQueue.on("job", (job: RoutedJob) => jobs.push(job));
  });

  after(() => {
    db.close();
  });

  it("routes known chat_id to its bound agent", () => {
    const job = routeMessage(db, { ...BASE_INPUT, chatId: "oc_bound_chat", larkMessageId: "om_r001" });
    assert.equal(job.agentId, seed.boundAgentId);
    assert.equal(job.chatId, "oc_bound_chat");
    assert.equal(job.text, "tính 2+2");
  });

  it("falls back to default agent for unknown chat_id", () => {
    const job = routeMessage(db, { ...BASE_INPUT, chatId: "oc_unknown_chat", larkMessageId: "om_r002" });
    assert.equal(job.agentId, seed.agentId); // lowest-id enabled agent
    assert.equal(job.chatId, "oc_unknown_chat");
  });

  it("emits job on engineQueue for each route", () => {
    assert.ok(jobs.length >= 2);
    assert.equal(jobs[0]?.agentId, seed.boundAgentId);
    assert.equal(jobs[1]?.agentId, seed.agentId);
  });

  it("includes all required RoutedJob fields", () => {
    const job = jobs[0]!;
    assert.ok(typeof job.chatId === "string");
    assert.ok(typeof job.projectId === "number");
    assert.ok(typeof job.agentId === "number");
    assert.ok(typeof job.userId === "string");
    assert.ok(typeof job.text === "string");
    assert.ok(typeof job.larkMessageId === "string");
    assert.ok(typeof job.eventId === "string");
    assert.ok(typeof job.chatType === "string");
  });

  it("throws when no agents exist at all", () => {
    const emptyDb = makeTestDb();
    assert.throws(
      () => routeMessage(emptyDb, { ...BASE_INPUT, chatId: "oc_any", larkMessageId: "om_r003" }),
      /No enabled agent/,
    );
    emptyDb.close();
  });
});
