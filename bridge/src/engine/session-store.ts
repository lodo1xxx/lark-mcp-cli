// session-store.ts — read/write sessions table keyed by chat_id.
// Column names match schema.sql exactly:
//   chat_id, project_id, agent_id, claude_session_id, last_active_at, message_count

import type Database from "better-sqlite3";
import type { SessionRow } from "../db/types.js";

export function getSession(db: Database.Database, chatId: string): SessionRow | undefined {
  return db
    .prepare<[string], SessionRow>(
      `SELECT * FROM sessions WHERE chat_id = ? LIMIT 1`,
    )
    .get(chatId);
}

export function upsertSession(
  db: Database.Database,
  chatId: string,
  projectId: number,
  agentId: number,
  claudeSessionId: string,
): void {
  db.prepare<[string, number, number, string]>(
    `INSERT INTO sessions (chat_id, project_id, agent_id, claude_session_id, last_active_at, message_count)
     VALUES (?, ?, ?, ?, datetime('now'), 1)
     ON CONFLICT (chat_id) DO UPDATE SET
       claude_session_id = excluded.claude_session_id,
       last_active_at    = datetime('now'),
       message_count     = message_count + 1`,
  ).run(chatId, projectId, agentId, claudeSessionId);
}
