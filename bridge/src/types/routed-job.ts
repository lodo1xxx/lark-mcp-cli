// RoutedJob: the unit of work handed off to the engine queue (phase-03).
// Produced by router.ts after filtering + dedup.

export interface RoutedJob {
  /** Lark open_chat_id */
  chatId: string;
  /** bridge DB project id */
  projectId: number;
  /** bridge DB agent id */
  agentId: number;
  /** Lark open_id of the sender */
  userId: string;
  /** user prompt text (mention prefix stripped); may be empty */
  text: string;
  /** Lark message_id — also the dedup key */
  larkMessageId: string;
  /** Lark event_id */
  eventId: string;
  /** 'group' | 'p2p' */
  chatType: string;
}
