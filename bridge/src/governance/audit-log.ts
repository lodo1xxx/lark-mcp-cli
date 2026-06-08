// audit-log.ts — typed append-only audit event writer.
// Treats audit_log as PII — local-only, never exposed via API without auth.
// All writes are synchronous (better-sqlite3) to avoid lost events on crash.

import type Database from "better-sqlite3";

export type AuditEventType =
  | "msg_in"
  | "run_started"
  | "run_done"
  | "run_failed"
  | "reply_sent"
  | "reply_failed"
  | "quota_denied"
  | "quota_auto_tightened"
  | "cohort_changed";

export interface AuditEntry {
  projectId: number;
  chatId?: string;
  userId?: string;
  eventType: AuditEventType;
  payload?: Record<string, unknown>;
}

/**
 * Append a typed audit event. Synchronous (SQLite) — never drops events.
 * payload is stored as JSON; round-trips correctly via JSON.parse.
 */
export function audit(db: Database.Database, entry: AuditEntry): void {
  db.prepare<[number, string | null, string | null, string, string]>(
    `INSERT INTO audit_log (project_id, chat_id, user_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    entry.projectId,
    entry.chatId ?? null,
    entry.userId ?? null,
    entry.eventType,
    JSON.stringify(entry.payload ?? {}),
  );
}
