// reply/send-reply.ts — send Claude output back to Lark chat via lark-cli subprocess.
// Sequential chunk delivery, retry with exponential backoff, fallback notice on hard fail.
// Persists outbound messages + audit_log rows.

import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { markdownToLark } from "./markdown-to-lark.js";
import { chunkText } from "./chunker.js";
import type { ReplyRequest, ReplyResult } from "./reply-types.js";

export interface SendReplyOptions {
  /** Path to lark-cli binary (default: "lark-cli"). */
  binary?: string;
  /** Max chars per chunk (default: 3000). */
  maxChars?: number;
  /** Max send attempts per chunk (default: 3). */
  maxRetries?: number;
  /** Base backoff ms (doubles each retry, default: 500). */
  backoffMs?: number;
  /** If true, pass --dry-run to lark-cli (no real send). */
  dryRun?: boolean;
}

interface SendChunkResult {
  messageId: string;
  success: boolean;
}

/** Spawn lark-cli to send one chunk. Returns sent message_id or throws. */
function spawnSend(
  binary: string,
  chatId: string,
  chunk: string,
  idempotencyKey: string,
  dryRun: boolean,
): string {
  const args = [
    "im",
    "+messages-send",
    "--as", "bot",
    "--chat-id", chatId,
    "--markdown", chunk,
    "--idempotency-key", idempotencyKey,
    "--json",
  ];
  if (dryRun) args.push("--dry-run");

  const result = spawnSync(binary, args, {
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });

  if (result.error) {
    throw new Error(`spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`lark-cli exit ${result.status ?? "?"}: ${result.stderr ?? ""}`);
  }

  try {
    // lark-cli --dry-run emits "=== Dry Run ===\n{...}" — strip non-JSON prefix
    const stdout = result.stdout ?? "";
    const jsonStart = stdout.indexOf("{");
    const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    // lark-cli returns { message_id: "..." } or nested { data: { message_id } }
    const msgId =
      (parsed["message_id"] as string | undefined) ??
      ((parsed["data"] as Record<string, unknown> | undefined)?.["message_id"] as string | undefined) ??
      "dry-run";
    return msgId;
  } catch {
    return "unknown";
  }
}

/** Sleep helper for backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Send one chunk with retry. Returns message_id or throws after maxRetries. */
async function sendChunkWithRetry(
  binary: string,
  chatId: string,
  chunk: string,
  idempotencyKey: string,
  maxRetries: number,
  backoffMs: number,
  dryRun: boolean,
): Promise<SendChunkResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const messageId = spawnSend(binary, chatId, chunk, idempotencyKey, dryRun);
      return { messageId, success: true };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1) {
        await sleep(backoffMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr;
}

/** Persist one outbound message row. */
function persistOutbound(
  db: Database.Database,
  chatId: string,
  content: string,
  sentMessageId: string,
): void {
  db.prepare<[string, string, string]>(
    `INSERT OR IGNORE INTO messages
       (chat_id, lark_message_id, direction, content)
     VALUES (?, ?, 'outbound', ?)`,
  ).run(chatId, sentMessageId, content);
}

/** Persist one audit_log row. */
function persistAudit(
  db: Database.Database,
  projectId: number,
  chatId: string,
  eventType: "reply_sent" | "reply_failed",
  payload: Record<string, unknown>,
): void {
  db.prepare<[number, string, string, string]>(
    `INSERT INTO audit_log (project_id, chat_id, event_type, payload_json)
     VALUES (?, ?, ?, ?)`,
  ).run(projectId, chatId, eventType, JSON.stringify(payload));
}

/** Send a fallback plain-text error notice when all retries exhausted. */
function sendFallbackNotice(binary: string, chatId: string, dryRun: boolean): void {
  const args = [
    "im", "+messages-send",
    "--as", "bot",
    "--chat-id", chatId,
    "--text", "⚠️ Reply failed — please try again.",
    "--json",
  ];
  if (dryRun) args.push("--dry-run");
  spawnSync(binary, args, { encoding: "utf-8", timeout: 10_000 });
}

/**
 * Main entry: normalize → chunk → send sequentially → persist.
 * On hard chunk failure: send fallback notice, write audit, continue remaining chunks.
 */
export async function sendReply(
  db: Database.Database,
  req: ReplyRequest,
  opts: SendReplyOptions = {},
): Promise<ReplyResult> {
  const binary = opts.binary ?? "lark-cli";
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const dryRun = opts.dryRun ?? false;

  const normalized = markdownToLark(req.text);
  const chunks = chunkText(normalized, { maxChars: opts.maxChars ?? 3000 });

  const sentMessageIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const idempotencyKey = `${req.inboundMessageId}:${i}`;

    try {
      const { messageId } = await sendChunkWithRetry(
        binary,
        req.chatId,
        chunk,
        idempotencyKey,
        maxRetries,
        backoffMs,
        dryRun,
      );

      // When lark-cli returns no real message_id (dry-run / parse fallback),
      // use the idempotency key as a stable unique identifier for the DB row.
      const storedId =
        messageId === "dry-run" || messageId === "unknown"
          ? `idem:${idempotencyKey}`
          : messageId;
      persistOutbound(db, req.chatId, chunk, storedId);
      persistAudit(db, req.projectId, req.chatId, "reply_sent", {
        inboundMessageId: req.inboundMessageId,
        sentMessageId: storedId,
        chunk: i,
        of: chunks.length,
      });

      sentMessageIds.push(storedId);
    } catch (err) {
      if (process.env["BRIDGE_LOG_LEVEL"] === "debug") {
        console.debug(`[reply] chunk ${i} failed:`, err);
      }

      // Send fallback notice once per failed chunk
      sendFallbackNotice(binary, req.chatId, dryRun);

      persistAudit(db, req.projectId, req.chatId, "reply_failed", {
        inboundMessageId: req.inboundMessageId,
        chunk: i,
        of: chunks.length,
        error: String(err),
      });
    }
  }

  return { sentMessageIds, chunks: chunks.length };
}
