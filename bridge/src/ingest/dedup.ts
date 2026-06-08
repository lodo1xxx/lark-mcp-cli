// Deduplication: INSERT OR IGNORE into messages; returns whether this is a new row.
// UNIQUE(lark_message_id) in the schema is the dedup key — redelivered events
// produce 0 changes and are silently skipped.

import type Database from "better-sqlite3";
import type { MessageRow } from "../db/types.js";

export interface DedupResult {
  isNew: boolean;
  /** Row id of the inserted (or pre-existing) message. */
  messageId: number;
}

export interface InboundMessageFields {
  chatId: string;
  larkMessageId: string;
  userId: string;
  content: string;
}

/**
 * Insert an inbound message if not already seen.
 * Uses INSERT OR IGNORE so duplicate lark_message_id is a no-op.
 * Returns { isNew: true, messageId } on first insert,
 *         { isNew: false, messageId } if already present.
 */
export function dedupMessage(
  db: Database.Database,
  fields: InboundMessageFields,
): DedupResult {
  const insert = db.prepare<[string, string, string, string]>(`
    INSERT OR IGNORE INTO messages
      (chat_id, lark_message_id, direction, user_id, content)
    VALUES (?, ?, 'inbound', ?, ?)
  `);

  const info = insert.run(
    fields.chatId,
    fields.larkMessageId,
    fields.userId,
    fields.content,
  );

  if (info.changes > 0) {
    return { isNew: true, messageId: Number(info.lastInsertRowid) };
  }

  // Already existed — fetch the existing row id
  const existing = db
    .prepare<[string], Pick<MessageRow, "id">>(
      "SELECT id FROM messages WHERE lark_message_id = ?",
    )
    .get(fields.larkMessageId);

  return { isNew: false, messageId: existing?.id ?? 0 };
}
