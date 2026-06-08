// governance.test.ts — unit tests for Phase-06 governance layer.
// Covers: rate-table, cost-meter, quota-store, quota-gate, audit-log,
//         cohort-classifier, auto-tighten, and an integration smoke test.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ddl = SCHEMA.split("\n")
    .filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);
  return db;
}

/** Seed a project + return its id. */
function seedProject(db: Database.Database, name = "test-project"): number {
  return Number(
    db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run(`cli_${name}`, name).lastInsertRowid,
  );
}

// ─── rate-table ───────────────────────────────────────────────────────────────

import { computeNotionalCost, DEFAULT_RATE_TABLE } from "../src/governance/rate-table.js";

describe("rate-table", () => {
  it("cache_read is ~10× cheaper than input", () => {
    const inputRate = DEFAULT_RATE_TABLE.inputPerMtok;
    const cacheRate = DEFAULT_RATE_TABLE.cacheReadPerMtok;
    const ratio = inputRate / cacheRate;
    // Ratio should be ~10 (within 2× tolerance)
    assert.ok(ratio >= 5 && ratio <= 20, `cache_read ratio ${ratio} should be 5–20×`);
  });

  it("computeNotionalCost: zero tokens → 0", () => {
    const cost = computeNotionalCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    assert.equal(cost, 0);
  });

  it("computeNotionalCost: 1M input tokens at default rate", () => {
    const cost = computeNotionalCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    assert.equal(cost, DEFAULT_RATE_TABLE.inputPerMtok);
  });

  it("computeNotionalCost: cache_read tokens 10× cheaper than same count of input", () => {
    const inputCost = computeNotionalCost({ inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const cacheCost = computeNotionalCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 });
    const ratio = inputCost / cacheCost;
    assert.ok(ratio >= 5 && ratio <= 20, `ratio ${ratio}`);
  });

  it("computeNotionalCost: real fixture — $0.132 first call is plausible", () => {
    // Live test: first call $0.132159, second call (cache) $0.012094
    // These come from Claude's total_cost_usd — just sanity-check our math gives same order of magnitude
    const firstCall = computeNotionalCost({
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 25_000,
    });
    const secondCall = computeNotionalCost({
      inputTokens: 500,
      outputTokens: 1_000,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 0,
    });
    // First call (cache-write heavy) should cost more than second (cache-read)
    assert.ok(firstCall > secondCall, `firstCall ${firstCall} should > secondCall ${secondCall}`);
    // Both should be in the cents range
    assert.ok(firstCall < 1 && firstCall > 0.001, `firstCall ${firstCall} out of expected range`);
  });
});

// ─── cost-meter ───────────────────────────────────────────────────────────────

import { priceRun } from "../src/governance/cost-meter.js";
import type { RunResult } from "../src/engine/engine-types.js";

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    text: "hello",
    sessionId: "sess_1",
    usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    notionalCostUsd: 0,
    ...overrides,
  };
}

describe("cost-meter", () => {
  it("uses provided total_cost_usd when > 0", () => {
    const result = makeRunResult({ notionalCostUsd: 0.132159 });
    const priced = priceRun(result);
    assert.equal(priced.source, "claude_provided");
    assert.equal(priced.notionalCostUsd, 0.132159);
  });

  it("falls back to rate-table when notionalCostUsd is 0", () => {
    const result = makeRunResult({ notionalCostUsd: 0 });
    const priced = priceRun(result);
    assert.equal(priced.source, "rate_table");
    assert.ok(priced.notionalCostUsd > 0);
  });

  it("rate-table fallback: cache_read priced ~10× cheaper than same input count", () => {
    const inputResult = makeRunResult({
      notionalCostUsd: 0,
      usage: { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    const cacheResult = makeRunResult({
      notionalCostUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 },
    });
    const inputPriced = priceRun(inputResult);
    const cachePriced = priceRun(cacheResult);
    const ratio = inputPriced.notionalCostUsd / cachePriced.notionalCostUsd;
    assert.ok(ratio >= 5 && ratio <= 20, `ratio ${ratio}`);
  });

  it("live fixture: $0.132 (first call) then $0.012 (cache) → first > second", () => {
    const first = priceRun(makeRunResult({ notionalCostUsd: 0.132159 }));
    const second = priceRun(makeRunResult({ notionalCostUsd: 0.012094 }));
    assert.ok(first.notionalCostUsd > second.notionalCostUsd);
    // Rollup: 20 messages, assume mix — total should be sane
    const total = first.notionalCostUsd + second.notionalCostUsd;
    assert.ok(total > 0.1 && total < 0.2, `total ${total}`);
  });
});

// ─── quota-store ──────────────────────────────────────────────────────────────

import { upsertUser, getUsageToday, getUserQuotaState, setQuotaCap } from "../src/governance/quota-store.js";

describe("quota-store", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeDb();
    projectId = seedProject(db, "qs-proj");
  });

  after(() => db.close());

  it("upsertUser creates user and returns id", () => {
    const id = upsertUser(db, projectId, "ou_user1", "Alice");
    assert.ok(typeof id === "number" && id > 0);
  });

  it("upsertUser is idempotent — same id on second call", () => {
    const id1 = upsertUser(db, projectId, "ou_idempotent");
    const id2 = upsertUser(db, projectId, "ou_idempotent");
    assert.equal(id1, id2);
  });

  it("getUsageToday returns zeros when no rows", () => {
    const userId = upsertUser(db, projectId, "ou_nodata");
    const usage = getUsageToday(db, userId);
    assert.equal(usage.msgCount, 0);
    assert.equal(usage.totalNotionalCostUsd, 0);
  });

  it("getUsageToday sums only today's rows (not yesterday's)", () => {
    const userId = upsertUser(db, projectId, "ou_today_test");

    // Insert a message row
    const msgId = Number(
      db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, ?)")
        .run("oc_chat1", "om_today1", "ou_today_test", "hi").lastInsertRowid,
    );
    const msgId2 = Number(
      db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, ?)")
        .run("oc_chat1", "om_yesterday1", "ou_today_test", "hi yesterday").lastInsertRowid,
    );

    // Today's quota_usage row
    db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, notional_cost_usd) VALUES (?, ?, ?, ?, ?)")
      .run(userId, msgId, 1000, 200, 0.005);

    // Yesterday's row — set created_at to yesterday
    db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, notional_cost_usd, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '-1 day'))")
      .run(userId, msgId2, 5000, 1000, 0.05);

    const usage = getUsageToday(db, userId);
    assert.equal(usage.msgCount, 1, "Should only count today's row");
    assert.ok(Math.abs(usage.totalNotionalCostUsd - 0.005) < 0.0001);
  });

  it("setQuotaCap + getUserQuotaState reads back correctly", () => {
    const userId = upsertUser(db, projectId, "ou_cap_test");
    setQuotaCap(db, userId, 10);
    const state = getUserQuotaState(db, userId);
    assert.ok(state !== null);
    assert.equal(state!.quotaCap, 10);
  });
});

// ─── quota-gate ───────────────────────────────────────────────────────────────

import { checkQuota } from "../src/governance/quota-gate.js";
import { updateUserCohort } from "../src/governance/quota-store.js";

describe("quota-gate", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeDb();
    projectId = seedProject(db, "qg-proj");
  });

  after(() => db.close());

  it("allows user under cap", () => {
    const userId = upsertUser(db, projectId, "ou_under_cap");
    const result = checkQuota(db, userId, 50);
    assert.equal(result.allow, true);
  });

  it("denies user at/over daily_message_cap with OVER_DAILY_CAP", () => {
    const userId = upsertUser(db, projectId, "ou_over_cap");

    // Insert 50 quota_usage rows (messages) for today
    for (let i = 0; i < 50; i++) {
      const msgId = Number(
        db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, 'hi')")
          .run("oc_gc", `om_gc_${i}`, "ou_over_cap").lastInsertRowid,
      );
      db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, notional_cost_usd) VALUES (?, ?, 100, 50, 0.001)")
        .run(userId, msgId);
    }

    const result = checkQuota(db, userId, 50);
    assert.equal(result.allow, false);
    if (!result.allow) {
      assert.equal(result.reason, "OVER_DAILY_CAP");
      assert.equal(result.msgCount, 50);
    }
  });

  it("denies disabled user with DISABLED reason", () => {
    const userId = upsertUser(db, projectId, "ou_disabled");
    updateUserCohort(db, userId, "disabled", 1.0);
    const result = checkQuota(db, userId, 50);
    assert.equal(result.allow, false);
    if (!result.allow) assert.equal(result.reason, "DISABLED");
  });

  it("denies auto-tightened user with AUTO_TIGHTENED reason", () => {
    const userId = upsertUser(db, projectId, "ou_tightened");
    setQuotaCap(db, userId, 3); // tighter than default 50

    // Insert 3 messages to hit the reduced cap
    for (let i = 0; i < 3; i++) {
      const msgId = Number(
        db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, 'hi')")
          .run("oc_at", `om_at_${i}`, "ou_tightened").lastInsertRowid,
      );
      db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, notional_cost_usd) VALUES (?, ?, 100, 50, 0.001)")
        .run(userId, msgId);
    }

    const result = checkQuota(db, userId, 50);
    assert.equal(result.allow, false);
    if (!result.allow) assert.equal(result.reason, "AUTO_TIGHTENED");
  });
});

// ─── audit-log ───────────────────────────────────────────────────────────────

import { audit } from "../src/governance/audit-log.js";

describe("audit-log", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeDb();
    projectId = seedProject(db, "al-proj");
  });

  after(() => db.close());

  it("writes a typed audit row", () => {
    audit(db, { projectId, chatId: "oc_1", userId: "ou_1", eventType: "msg_in", payload: { foo: "bar" } });
    const row = db.prepare("SELECT * FROM audit_log WHERE event_type = 'msg_in' LIMIT 1").get() as { payload_json: string; event_type: string } | undefined;
    assert.ok(row);
    assert.equal(row!.event_type, "msg_in");
  });

  it("payload round-trips as JSON", () => {
    const payload = { larkMessageId: "om_test", cost: 0.042, nested: { a: 1 } };
    audit(db, { projectId, eventType: "run_done", payload });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event_type = 'run_done' LIMIT 1").get() as { payload_json: string } | undefined;
    assert.ok(row);
    const parsed = JSON.parse(row!.payload_json) as typeof payload;
    assert.equal(parsed.larkMessageId, "om_test");
    assert.equal(parsed.cost, 0.042);
    assert.deepEqual(parsed.nested, { a: 1 });
  });

  it("works with optional fields omitted", () => {
    audit(db, { projectId, eventType: "quota_denied" });
    const row = db.prepare("SELECT * FROM audit_log WHERE event_type = 'quota_denied' LIMIT 1").get();
    assert.ok(row);
  });

  it("writes all supported event types without throwing", () => {
    const types = [
      "msg_in", "run_started", "run_done", "reply_sent",
      "reply_failed", "quota_denied", "quota_auto_tightened", "cohort_changed",
    ] as const;
    for (const eventType of types) {
      assert.doesNotThrow(() => audit(db, { projectId, eventType }));
    }
  });
});

// ─── cohort-classifier ───────────────────────────────────────────────────────

import { classifyUser } from "../src/governance/cohort-classifier.js";

describe("cohort-classifier", () => {
  it("classifies dormant user (inactive 7+ days)", () => {
    const { cohort } = classifyUser({
      totalMessages: 10, messagesToday: 0, denyRate: 0, daysSinceLastMessage: 7, repeatRate: 0,
    });
    assert.equal(cohort, "dormant");
  });

  it("classifies spam_prone user (high volume + high deny rate)", () => {
    const { cohort, riskScore } = classifyUser({
      totalMessages: 20, messagesToday: 10, denyRate: 0.5, daysSinceLastMessage: 0, repeatRate: 0,
    });
    assert.equal(cohort, "spam_prone");
    assert.ok(riskScore > 0.5, `riskScore ${riskScore} should be > 0.5`);
  });

  it("classifies stuck user (high repeat rate)", () => {
    const { cohort } = classifyUser({
      totalMessages: 5, messagesToday: 3, denyRate: 0.1, daysSinceLastMessage: 0, repeatRate: 0.7,
    });
    assert.equal(cohort, "stuck");
  });

  it("classifies power user (high volume + low deny)", () => {
    const { cohort, riskScore } = classifyUser({
      totalMessages: 30, messagesToday: 8, denyRate: 0.05, daysSinceLastMessage: 0, repeatRate: 0,
    });
    assert.equal(cohort, "power");
    assert.ok(riskScore < 0.15, `riskScore ${riskScore} should be < 0.15`);
  });

  it("classifies normal user by default", () => {
    const { cohort } = classifyUser({
      totalMessages: 5, messagesToday: 2, denyRate: 0.1, daysSinceLastMessage: 1, repeatRate: 0.1,
    });
    assert.equal(cohort, "normal");
  });

  it("risk_score is monotonically higher for higher deny rates (spam path)", () => {
    const lowRisk = classifyUser({
      totalMessages: 20, messagesToday: 10, denyRate: 0.3, daysSinceLastMessage: 0, repeatRate: 0,
    });
    const highRisk = classifyUser({
      totalMessages: 20, messagesToday: 10, denyRate: 0.8, daysSinceLastMessage: 0, repeatRate: 0,
    });
    assert.ok(highRisk.riskScore > lowRisk.riskScore, `highRisk ${highRisk.riskScore} should > lowRisk ${lowRisk.riskScore}`);
  });
});

// ─── auto-tighten ────────────────────────────────────────────────────────────

import { maybeTighten, resetQuotaCap, DEFAULT_AUTO_TIGHTEN_CONFIG } from "../src/governance/auto-tighten.js";

describe("auto-tighten", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeDb();
    projectId = seedProject(db, "at-proj");
  });

  after(() => db.close());

  it("tightens cap when spam thresholds tripped", () => {
    const userId = upsertUser(db, projectId, "ou_spam_tighten");

    // Seed sent messages
    for (let i = 0; i < 15; i++) {
      const msgId = Number(
        db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, 'hi')")
          .run("oc_spam", `om_sp_${i}`, "ou_spam_tighten").lastInsertRowid,
      );
      db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, notional_cost_usd) VALUES (?, ?, 100, 50, 0.001)")
        .run(userId, msgId);
    }

    // Seed deny audit rows (high deny rate: 10 denies / 25 total = 0.4)
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO audit_log (project_id, user_id, event_type, payload_json) VALUES (?, ?, 'quota_denied', '{}')")
        .run(projectId, "ou_spam_tighten");
    }

    maybeTighten(db, userId, "ou_spam_tighten", projectId, 50, DEFAULT_AUTO_TIGHTEN_CONFIG);

    const state = getUserQuotaState(db, userId);
    assert.ok(state!.quotaCap !== null && state!.quotaCap < 50, `cap should be reduced from 50, got ${state!.quotaCap}`);

    // Audit row written
    const auditRow = db.prepare("SELECT * FROM audit_log WHERE event_type = 'quota_auto_tightened' LIMIT 1").get();
    assert.ok(auditRow, "Should have written quota_auto_tightened audit row");
  });

  it("does NOT tighten when thresholds not met", () => {
    const userId = upsertUser(db, projectId, "ou_normal_no_tighten");
    maybeTighten(db, userId, "ou_normal_no_tighten", projectId, 50, DEFAULT_AUTO_TIGHTEN_CONFIG);
    const state = getUserQuotaState(db, userId);
    // cap should remain null (not set)
    assert.equal(state!.quotaCap, null);
  });

  it("resetQuotaCap sets cap back to null", () => {
    const userId = upsertUser(db, projectId, "ou_reset_cap");
    setQuotaCap(db, userId, 5);
    resetQuotaCap(db, userId);
    const state = getUserQuotaState(db, userId);
    assert.equal(state!.quotaCap, null);
  });
});

// ─── integration smoke test ──────────────────────────────────────────────────

describe("governance integration smoke", () => {
  let db: Database.Database;
  let projectId: number;

  before(() => {
    db = makeDb();
    projectId = seedProject(db, "int-proj");
  });

  after(() => db.close());

  it("full lifecycle: upsert user → quota check (allow) → price run → persist → audit rows present", () => {
    // 1. Upsert user
    const userId = upsertUser(db, projectId, "ou_lifecycle", "Lifecycle User");
    assert.ok(userId > 0);

    // 2. Quota check — should allow (no usage yet)
    const quotaResult = checkQuota(db, userId, 50);
    assert.equal(quotaResult.allow, true);

    // 3. audit msg_in
    audit(db, { projectId, chatId: "oc_int", userId: "ou_lifecycle", eventType: "msg_in", payload: { larkMessageId: "om_int1" } });

    // 4. audit run_started
    audit(db, { projectId, chatId: "oc_int", userId: "ou_lifecycle", eventType: "run_started", payload: { larkMessageId: "om_int1" } });

    // 5. Price run (use claude-provided cost)
    const runResult = makeRunResult({ notionalCostUsd: 0.132159 });
    const { notionalCostUsd, source } = priceRun(runResult);
    assert.equal(source, "claude_provided");
    assert.equal(notionalCostUsd, 0.132159);

    // 6. Persist quota_usage row
    const msgId = Number(
      db.prepare("INSERT INTO messages (chat_id, lark_message_id, direction, user_id, content) VALUES (?, ?, 'inbound', ?, 'hi')")
        .run("oc_int", "om_int1", "ou_lifecycle").lastInsertRowid,
    );
    db.prepare("INSERT INTO quota_usage (user_id, message_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, notional_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(userId, msgId, 1000, 500, 0, 0, notionalCostUsd);

    // 7. audit run_done
    audit(db, { projectId, chatId: "oc_int", userId: "ou_lifecycle", eventType: "run_done", payload: { notionalCostUsd } });

    // 8. Verify usage row present
    const usage = getUsageToday(db, userId);
    assert.equal(usage.msgCount, 1);
    assert.ok(Math.abs(usage.totalNotionalCostUsd - 0.132159) < 0.000001);

    // 9. Verify audit rows
    const auditRows = db.prepare("SELECT event_type FROM audit_log WHERE user_id = 'ou_lifecycle' ORDER BY id").all() as { event_type: string }[];
    const eventTypes = auditRows.map((r) => r.event_type);
    assert.ok(eventTypes.includes("msg_in"), "msg_in audit missing");
    assert.ok(eventTypes.includes("run_started"), "run_started audit missing");
    assert.ok(eventTypes.includes("run_done"), "run_done audit missing");
  });
});
