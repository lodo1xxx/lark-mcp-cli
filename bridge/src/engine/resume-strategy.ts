// resume-strategy.ts — decide fresh vs --resume; handle SESSION_LOST → fresh retry.
// If stored session_id exists, attempt --resume.
// On SESSION_LOST, retry as fresh run and overwrite the stored session.

import type Database from "better-sqlite3";
import { runClaude } from "./claude-runner.js";
import { EngineError, type RunRequest, type RunResult } from "./engine-types.js";
import { getSession, upsertSession } from "./session-store.js";

export interface ResumeContext {
  db: Database.Database;
  binary: string;
  chatId: string;
  projectId: number;
  agentId: number;
  baseReq: RunRequest;
}

export async function runWithResume(ctx: ResumeContext): Promise<RunResult> {
  const { db, binary, chatId, projectId, agentId, baseReq } = ctx;
  const session = getSession(db, chatId);
  const storedId = session?.claude_session_id ?? null;

  const req: RunRequest = storedId
    ? { ...baseReq, sessionId: storedId }
    : { ...baseReq, sessionId: undefined };

  try {
    const result = await runClaude(binary, req);
    upsertSession(db, chatId, projectId, agentId, result.sessionId);
    return result;
  } catch (err) {
    if (err instanceof EngineError && err.code === "SESSION_LOST" && storedId) {
      // Retry as fresh run — session expired or unknown
      console.warn(`[resume-strategy] SESSION_LOST for chat ${chatId}, retrying fresh`);
      const freshReq: RunRequest = { ...baseReq, sessionId: undefined };
      const result = await runClaude(binary, freshReq);
      upsertSession(db, chatId, projectId, agentId, result.sessionId);
      return result;
    }
    throw err;
  }
}
