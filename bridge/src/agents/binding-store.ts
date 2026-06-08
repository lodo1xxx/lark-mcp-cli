// binding-store.ts — CRUD for chat_bindings table.
// Maps Lark chat_id → agent_id within a project.

import type Database from "better-sqlite3";
import type { ChatBindingRow } from "../db/types.js";

export interface BindingResult {
  agentId: number;
  projectId: number;
  chatId: string;
  enabled: boolean;
}

/** Get the active binding for a chat, or undefined if none. */
export function getBinding(
  db: Database.Database,
  chatId: string,
): BindingResult | undefined {
  const row = db
    .prepare<[string], ChatBindingRow>(
      `SELECT * FROM chat_bindings WHERE chat_id = ? AND enabled = 1 LIMIT 1`,
    )
    .get(chatId);

  if (!row) return undefined;

  return {
    agentId: row.agent_id,
    projectId: row.project_id,
    chatId: row.chat_id,
    enabled: row.enabled === 1,
  };
}

/** Set or update the binding for a chat. Creates if not exists, updates if exists. */
export function setBinding(
  db: Database.Database,
  chatId: string,
  agentId: number,
  projectId: number,
): void {
  db.prepare(
    `INSERT INTO chat_bindings (project_id, chat_id, agent_id, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (project_id, chat_id)
     DO UPDATE SET agent_id = excluded.agent_id, enabled = 1`,
  ).run(projectId, chatId, agentId);
}

/** Disable a binding (soft delete). */
export function disableBinding(
  db: Database.Database,
  chatId: string,
  projectId: number,
): void {
  db.prepare(
    `UPDATE chat_bindings SET enabled = 0 WHERE chat_id = ? AND project_id = ?`,
  ).run(chatId, projectId);
}

/** List all active bindings, optionally filtered by project. */
export function listBindings(
  db: Database.Database,
  projectId?: number,
): BindingResult[] {
  const rows = projectId !== undefined
    ? db
        .prepare<[number], ChatBindingRow>(
          `SELECT * FROM chat_bindings WHERE project_id = ? AND enabled = 1`,
        )
        .all(projectId)
    : db
        .prepare<[], ChatBindingRow>(
          `SELECT * FROM chat_bindings WHERE enabled = 1`,
        )
        .all();

  return rows.map((row) => ({
    agentId: row.agent_id,
    projectId: row.project_id,
    chatId: row.chat_id,
    enabled: row.enabled === 1,
  }));
}
