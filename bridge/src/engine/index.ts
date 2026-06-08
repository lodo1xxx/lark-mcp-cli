// engine/index.ts — orchestrator: quota gate → resume-strategy
// → persist usage on messages row + quota_usage row → return RunResult text.
// Phase-04 sends the reply to Lark; this module just logs it.

import type Database from "better-sqlite3";
import type { RoutedJob } from "../types/routed-job.js";
import type { RunResult } from "./engine-types.js";
import { RunQueue } from "./run-queue.js";
import { runWithResume } from "./resume-strategy.js";
import { resolveAgent } from "../agents/resolve-agent.js";
import { upsertUser } from "../governance/quota-store.js";
import { priceRun } from "../governance/cost-meter.js";
import { audit } from "../governance/audit-log.js";
import type { RateTable } from "../governance/rate-table.js";

export interface EngineConfig {
  binary: string;
  concurrency: number;
  timeoutMs: number;
  defaultModel?: string;
  /** Optional rate table override for notional cost fallback. */
  rateTable?: RateTable;
}

let _queue: RunQueue | null = null;

function getQueue(concurrency: number): RunQueue {
  if (!_queue) _queue = new RunQueue(concurrency);
  return _queue;
}

/** Upsert user + persist usage tokens onto message row and quota_usage row. */
function persistUsage(db: Database.Database, job: RoutedJob, result: RunResult, rateTable?: RateTable): void {
  // Update the inbound message with the claude_session_id
  db.prepare<[string, string]>(
    `UPDATE messages SET claude_session_id = ? WHERE lark_message_id = ?`,
  ).run(result.sessionId, job.larkMessageId);

  // Look up the messages row id for quota_usage FK
  const msgRow = db
    .prepare<[string], { id: number }>(`SELECT id FROM messages WHERE lark_message_id = ? LIMIT 1`)
    .get(job.larkMessageId);

  if (!msgRow) return; // message may not exist in test stubs

  // Phase-06: upsert user so quota_usage FK is always satisfied
  const userId = upsertUser(db, job.projectId, job.userId);

  // Compute NOTIONAL cost — prefer Claude's total_cost_usd, fallback to rate-table
  const { notionalCostUsd } = priceRun(result, rateTable);

  db.prepare<[number, number, number, number, number, number, number]>(
    `INSERT INTO quota_usage
       (user_id, message_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, notional_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    msgRow.id,
    result.usage.inputTokens,
    result.usage.outputTokens,
    result.usage.cacheReadTokens,
    result.usage.cacheWriteTokens,
    notionalCostUsd,
  );

  audit(db, {
    projectId: job.projectId,
    chatId: job.chatId,
    userId: job.userId,
    eventType: "run_done",
    payload: {
      larkMessageId: job.larkMessageId,
      sessionId: result.sessionId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      notionalCostUsd,
    },
  });
}

export async function runEngineJob(
  db: Database.Database,
  job: RoutedJob,
  cfg: EngineConfig,
): Promise<RunResult> {
  const queue = getQueue(cfg.concurrency);

  return queue.enqueue(async () => {
    // Phase-06: audit run_started
    audit(db, {
      projectId: job.projectId,
      chatId: job.chatId,
      userId: job.userId,
      eventType: "run_started",
      payload: { larkMessageId: job.larkMessageId },
    });

    // Phase-05: resolve agent from registry → provides cwd, model, mcp config, allowed tools.
    // Falls back gracefully if registry not loaded (no db agents) — baseReq still has defaults.
    let agentCwd: string | undefined;
    let agentModel: string | undefined = cfg.defaultModel;
    let agentMcpConfigPath: string | undefined;
    let agentAllowedTools: string[] | undefined;
    let resolvedAgentId = job.agentId;

    try {
      const resolved = resolveAgent(db, job.chatId);
      agentCwd = resolved.agent.folderPath;
      agentModel = resolved.agent.model ?? cfg.defaultModel;
      agentMcpConfigPath = resolved.mcp.mcpConfigPath;
      agentAllowedTools = resolved.mcp.allowedToolNames;
      resolvedAgentId = resolved.dbId;
    } catch (err) {
      console.warn(`[engine] resolve-agent failed for chat ${job.chatId}: ${String(err)} — running without agent config`);
    }

    let result: RunResult;
    try {
      result = await runWithResume({
        db,
        binary: cfg.binary,
        chatId: job.chatId,
        projectId: job.projectId,
        agentId: resolvedAgentId,
        baseReq: {
          prompt: job.text,
          model: agentModel,
          timeoutMs: cfg.timeoutMs,
          cwd: agentCwd,
          mcpConfigPath: agentMcpConfigPath,
          allowedTools: agentAllowedTools,
        },
      });
    } catch (err) {
      const errCode = err instanceof Error ? err.message : String(err);
      audit(db, {
        projectId: job.projectId,
        chatId: job.chatId,
        userId: job.userId,
        eventType: "run_failed",
        payload: { larkMessageId: job.larkMessageId, error: errCode },
      });
      throw err;
    }

    persistUsage(db, job, result, cfg.rateTable);

    console.info(
      `[engine] chat:${job.chatId} session:${result.sessionId} ` +
        `tokens:${result.usage.inputTokens}in/${result.usage.outputTokens}out ` +
        `cost:$${result.notionalCostUsd.toFixed(6)} reply:"${result.text.slice(0, 80)}"`,
    );

    return result;
  });
}

/** Reset the singleton queue (useful in tests). */
export function resetQueue(): void {
  _queue = null;
}

/** Return current in-flight / queued gauge snapshot (zero if queue not yet created). */
export function getGauges(): { inFlight: number; queued: number } {
  if (!_queue) return { inFlight: 0, queued: 0 };
  return { inFlight: _queue.inFlight, queued: _queue.queued };
}
