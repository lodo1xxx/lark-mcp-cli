// reply/markdown-to-lark.ts — minimal GFM → Lark-safe normalization.
// lark-cli --markdown already handles most rendering; we only sanitize here.
// YAGNI: keep it minimal for MVP — future iterations can add more transforms.

const PLACEHOLDER = "_No response._";

/**
 * Normalize Claude GFM output for Lark delivery.
 * - Returns placeholder for empty/whitespace-only text.
 * - Trims leading/trailing whitespace.
 * - Hook: add further transforms here without touching send-reply.ts.
 */
export function markdownToLark(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return PLACEHOLDER;
  return trimmed;
}
