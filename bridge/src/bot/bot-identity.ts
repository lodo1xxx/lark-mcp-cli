// Bot identity provider — supplies bot display name from config.
// Phase-02 simplified: NO open_id fetch needed (group @mention is implied by
// Lark's delivery rules). Just provides the display name for mention-stripping.

import { loadConfig } from "../config/load-config.js";

let _botDisplayName: string | null = null;

/**
 * Returns the bot's display name as configured.
 * Cached after first call.
 */
export function getBotDisplayName(): string {
  if (_botDisplayName !== null) return _botDisplayName;
  const cfg = loadConfig();
  _botDisplayName = cfg.bot_display_name;
  return _botDisplayName;
}

/** Reset cached value (useful in tests). */
export function resetBotIdentity(): void {
  _botDisplayName = null;
}
