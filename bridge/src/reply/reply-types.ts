// reply/reply-types.ts — shared types for the reply path (Claude → Lark).

export interface ReplyRequest {
  /** Lark open_chat_id to send to. */
  chatId: string;
  /** Claude's text output (GFM markdown). */
  text: string;
  /** The inbound Lark message_id — used for idempotency keys + DB linkage. */
  inboundMessageId: string;
  /** Project id for audit_log FK. */
  projectId: number;
}

export interface ReplyResult {
  /** Lark message IDs of the sent chunks. */
  sentMessageIds: string[];
  /** Number of chunks sent. */
  chunks: number;
}

export type ReplyErrorCode =
  | "SEND_FAILED"
  | "FALLBACK_SENT"
  | "EMPTY_TEXT";

export class ReplyError extends Error {
  constructor(
    public readonly code: ReplyErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ReplyError";
  }
}

export function isReplyError(err: unknown): err is ReplyError {
  return err instanceof ReplyError;
}
