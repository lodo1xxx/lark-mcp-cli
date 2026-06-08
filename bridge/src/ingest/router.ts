// Router: resolves chat_id → chat_binding → agent; falls back to default agent.
// Builds a RoutedJob and dispatches to the engine via runEngineJob (phase-03).
// Phase-04: after engine returns, sends the reply back to Lark via sendReply.
// Phase-06: quota gate checked before engine spawn; deny → polite Lark message.

import { EventEmitter } from "node:events";
import type Database from "better-sqlite3";
import type { AgentRow, ChatBindingRow } from "../db/types.js";
import type { RoutedJob } from "../types/routed-job.js";
import { runEngineJob, type EngineConfig } from "../engine/index.js";
import { sendReply } from "../reply/send-reply.js";
import { upsertUser } from "../governance/quota-store.js";
import { checkQuota } from "../governance/quota-gate.js";
import { audit } from "../governance/audit-log.js";

const HELP_TEXT =
  "Hi! I'm a Claude AI assistant. Ask me anything — mention me with a question and I'll help.";

const QUOTA_DENY_TEXT =
  "⚠️ Bạn đã đạt giới hạn tin nhắn hôm nay. Vui lòng thử lại vào ngày mai!";

// ── Engine queue shim ──────────────────────────────────────────────────────────
// Kept as EventEmitter so existing tests (which listen on engineQueue "job") still pass.
// push() dispatches to runEngineJob + sendReply when db, cfg, and replyCfg are provided.

export interface ReplyConfig {
  binary: string;
  maxChars: number;
  /** Daily message cap for quota gate (0 = unlimited). */
  dailyMessageCap?: number;
}

class EngineQueue extends EventEmitter {
  push(job: RoutedJob, db?: Database.Database, cfg?: EngineConfig, replyCfg?: ReplyConfig): void {
    console.log(
      `[router] job queued — chat:${job.chatId} agent:${job.agentId} ` +
        `msg:${job.larkMessageId} text:"${job.text.slice(0, 60)}"`,
    );
    this.emit("job", job);

    if (!db || !cfg) return;

    // Phase-06: upsert user + quota gate BEFORE any engine spawn
    const dailyMessageCap = replyCfg?.dailyMessageCap ?? 50;
    const userId = upsertUser(db, job.projectId, job.userId);

    audit(db, {
      projectId: job.projectId,
      chatId: job.chatId,
      userId: job.userId,
      eventType: "msg_in",
      payload: { larkMessageId: job.larkMessageId },
    });

    const quotaResult = checkQuota(db, userId, dailyMessageCap);
    if (!quotaResult.allow) {
      audit(db, {
        projectId: job.projectId,
        chatId: job.chatId,
        userId: job.userId,
        eventType: "quota_denied",
        payload: { reason: quotaResult.reason, msgCount: quotaResult.msgCount, cap: quotaResult.cap },
      });
      sendReply(db, {
        chatId: job.chatId,
        text: QUOTA_DENY_TEXT,
        inboundMessageId: job.larkMessageId,
        projectId: job.projectId,
      }, {
        binary: replyCfg?.binary ?? "lark-cli",
        maxChars: replyCfg?.maxChars,
      }).catch((err: unknown) => {
        console.error(`[router] quota-deny reply error for msg ${job.larkMessageId}:`, err);
      });
      this.emit("quota_denied", job, quotaResult.reason);
      return;
    }

    // Empty prompt path: reply help line, skip engine entirely (KISS).
    if (!job.text.trim()) {
      sendReply(db, {
        chatId: job.chatId,
        text: HELP_TEXT,
        inboundMessageId: job.larkMessageId,
        projectId: job.projectId,
      }, {
        binary: replyCfg?.binary ?? "lark-cli",
        maxChars: replyCfg?.maxChars,
      }).catch((err: unknown) => {
        console.error(`[router] help-reply error for msg ${job.larkMessageId}:`, err);
      });
      this.emit("help_reply", job);
      return;
    }

    runEngineJob(db, job, cfg)
      .then((result) => {
        return sendReply(db, {
          chatId: job.chatId,
          text: result.text,
          inboundMessageId: job.larkMessageId,
          projectId: job.projectId,
        }, {
          binary: replyCfg?.binary ?? "lark-cli",
          maxChars: replyCfg?.maxChars,
        });
      })
      .then((replyResult) => {
        if (process.env["BRIDGE_LOG_LEVEL"] === "debug") {
          console.debug(
            `[router] reply sent chat:${job.chatId} chunks:${replyResult.chunks}`,
          );
        }
      })
      .catch((err: unknown) => {
        console.error(`[router] engine/reply error for msg ${job.larkMessageId}:`, err);
      });
  }
}

export const engineQueue = new EngineQueue();

// ── Router ─────────────────────────────────────────────────────────────────────

export interface RouteInput {
  chatId: string;
  userId: string;
  text: string;
  larkMessageId: string;
  eventId: string;
  chatType: string;
}

/**
 * Resolve the agent for a given chat_id and emit a RoutedJob.
 * Lookup order: chat_bindings → first enabled agent in the project → throws.
 */
export function routeMessage(
  db: Database.Database,
  input: RouteInput,
  cfg?: EngineConfig,
  replyCfg?: ReplyConfig,
): RoutedJob {
  // 1. Try chat_bindings (enabled only)
  const binding = db
    .prepare<[string], ChatBindingRow & { project_id: number }>(
      `SELECT cb.*, cb.project_id
         FROM chat_bindings cb
        WHERE cb.chat_id = ? AND cb.enabled = 1
        LIMIT 1`,
    )
    .get(input.chatId);

  if (binding) {
    const job: RoutedJob = {
      chatId: input.chatId,
      projectId: binding.project_id,
      agentId: binding.agent_id,
      userId: input.userId,
      text: input.text,
      larkMessageId: input.larkMessageId,
      eventId: input.eventId,
      chatType: input.chatType,
    };
    engineQueue.push(job, db, cfg, replyCfg);
    return job;
  }

  // 2. Fallback: first enabled agent across all projects
  const defaultAgent = db
    .prepare<[], AgentRow>(
      `SELECT * FROM agents WHERE enabled = 1 ORDER BY id ASC LIMIT 1`,
    )
    .get();

  if (!defaultAgent) {
    throw new Error(`[router] No enabled agent found for chat ${input.chatId} and no default agent configured.`);
  }

  const job: RoutedJob = {
    chatId: input.chatId,
    projectId: defaultAgent.project_id,
    agentId: defaultAgent.id,
    userId: input.userId,
    text: input.text,
    larkMessageId: input.larkMessageId,
    eventId: input.eventId,
    chatType: input.chatType,
  };
  engineQueue.push(job, db, cfg, replyCfg);
  return job;
}
