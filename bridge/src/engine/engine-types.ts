// Engine types: RunRequest, RunResult, and typed EngineError union.

export interface RunRequest {
  prompt: string;
  sessionId?: string;
  agentName?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];   // prefixed mcp__lark-cli__<name> tool names
  model?: string;
  effort?: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface RunResult {
  text: string;
  sessionId: string;
  usage: TokenUsage;
  notionalCostUsd: number;
  raw?: unknown;
}

// ── Typed error union ──────────────────────────────────────────────────────────

export type EngineErrorCode =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "SESSION_LOST"
  | "SPAWN_FAILED"
  | "BAD_OUTPUT";

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export function isEngineError(err: unknown): err is EngineError {
  return err instanceof EngineError;
}
