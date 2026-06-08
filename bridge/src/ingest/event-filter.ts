// Event filter + mention-strip for im.message.receive_v1 events.
//
// Confirmed payload shape (no mentions[] array):
//   { type, event_id, timestamp, id, message_id, create_time,
//     chat_id, chat_type, message_type, sender_id, content }
//
// Accept rules:
//   1. chat_type === "group"   (p2p dropped)
//   2. message_type === "text" (skip images, files, etc. for MVP)
//   3. content MUST mention THIS bot ("@<botName>"). Some groups grant the bot
//      "receive all messages", so a group event does NOT imply the bot was
//      @mentioned — we verify the token ourselves. @all ("@_all"),
//      @other-person, and plain chatter are dropped (else the bot spams).

/** Minimal shape we care about from a raw lark-cli NDJSON line. */
export interface LarkEvent {
  type: string;
  event_id: string;
  message_id: string;
  chat_id: string;
  chat_type: string;
  message_type: string;
  sender_id: string;
  content: string;
  create_time?: string;
  timestamp?: string;
}

export interface FilterResult {
  accepted: boolean;
  /** Prompt text with @BotName prefix stripped; empty string if mention-only. */
  text: string;
  event: LarkEvent;
}

/**
 * Type-guard: does the raw object look like a LarkEvent we can process?
 * Fields checked are only the ones we read downstream.
 */
export function isLarkEvent(raw: unknown): raw is LarkEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r["type"] === "string" &&
    typeof r["event_id"] === "string" &&
    typeof r["message_id"] === "string" &&
    typeof r["chat_id"] === "string" &&
    typeof r["chat_type"] === "string" &&
    typeof r["message_type"] === "string" &&
    typeof r["sender_id"] === "string" &&
    typeof r["content"] === "string"
  );
}

/**
 * Does the content mention THIS bot by its display name ("@<botName>")?
 * Case-insensitive, matches anywhere in the message. Used to gate group events
 * since group delivery alone does not guarantee the bot was @mentioned.
 */
export function mentionsBot(content: string, botName: string): boolean {
  if (!botName) return false;
  return content.toLowerCase().includes(`@${botName}`.toLowerCase());
}

/**
 * Remove the "@<botName>" token from content (case-insensitive), wherever it
 * appears, and collapse leftover whitespace. e.g.
 *   "@Chanh Quản Gia tính 2+2" (bot "Chanh Quản Gia") → "tính 2+2"
 */
export function stripMentionPrefix(content: string, botName: string): string {
  const trimmed = content.trim();
  const token = `@${botName}`;
  const idx = trimmed.toLowerCase().indexOf(token.toLowerCase());
  if (idx === -1) return trimmed;
  const without = trimmed.slice(0, idx) + trimmed.slice(idx + token.length);
  return without.replace(/\s+/g, " ").trim();
}

/**
 * Apply filter rules and strip mention prefix.
 * Returns { accepted: false } for events that should be dropped silently.
 */
export function filterEvent(raw: unknown, botDisplayName: string): FilterResult {
  if (!isLarkEvent(raw)) {
    return { accepted: false, text: "", event: raw as LarkEvent };
  }

  const event = raw;

  // Rule 1: group only (p2p and other types dropped)
  if (event.chat_type !== "group") {
    return { accepted: false, text: "", event };
  }

  // Rule 2: text messages only (MVP)
  if (event.message_type !== "text") {
    return { accepted: false, text: "", event };
  }

  // Rule 3: must @mention this bot (drop @all, @others, plain chatter)
  if (!mentionsBot(event.content, botDisplayName)) {
    return { accepted: false, text: "", event };
  }

  const text = stripMentionPrefix(event.content, botDisplayName);
  return { accepted: true, text, event };
}
