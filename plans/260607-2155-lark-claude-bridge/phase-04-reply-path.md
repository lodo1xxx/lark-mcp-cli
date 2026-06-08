# Phase 04 — Reply Path (Claude output → Lark, markdown, long-msg, cards)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-03](phase-03-claude-engine-adapter.md)
- Repo evidence: `lark-cli im send`, `cmd/mcp/` (lark_im_send, lark_im_card_send)

## Overview
- **Priority**: P1 (closes the loop — MVP done after this)
- **Status**: complete (2026-06-08)
- **Effort**: 1d
- Take Claude's text result and send it back to the originating `chat_id` via `lark-cli im send`
  (or interactive card). Handle markdown→Lark conversion, message length limits, and send failures.

## Key Insights
- Reply via subprocess `lark-cli im send` — do NOT reimplement Lark message API (DRY). Card via MCP tool
  `lark_im_card_send` if rich formatting needed; start with plain/markdown text (KISS).
- Lark has per-message size limits → chunk long Claude outputs into ordered parts.
- Claude emits GitHub-flavored markdown; Lark text vs interactive-card render differently. MVP: send as Lark
  markdown-ish text; upgrade to card only if formatting is poor.
- Persist the outbound message (`direction='out'`) and link it to the inbound `message_id` for audit/threading.

## Requirements
**Functional**
- `sendReply(chatId, text)` → spawn `lark-cli im send` targeting the chat; receive_id_type = chat_id.
- Markdown normalize: keep code blocks/lists readable in Lark; strip/convert unsupported syntax.
- Long-message chunking: split > limit into N parts (`(1/3)` prefixes), send in order.
- On send failure: retry with backoff; if still failing, log to audit + post a short fallback error message.
- Persist outbound message row + audit entry.

**Non-functional**
- Files < 200 lines. No secrets in args. Use argv array (no shell string).

## Architecture
```
bridge/src/reply/
  send-reply.ts          # spawn lark-cli im send; chunk loop; retry
  markdown-to-lark.ts    # GFM → Lark-safe text (code fences, lists, links)
  chunker.ts             # split text on size limit, preserve code blocks
  reply-types.ts
```
Flow: phase-03 RunResult.text → `markdown-to-lark` → `chunker` → `send-reply` (per chunk) →
persist outbound `messages` + `audit_log`.

## Related Code Files
**Create**: `bridge/src/reply/send-reply.ts`, `markdown-to-lark.ts`, `chunker.ts`, `reply-types.ts`.
**Modify**: `bridge/src/index.ts` (connect engine result → reply); engine result handler from phase-03.
**Delete**: none.

## Implementation Steps
1. Confirm `lark-cli im send` flags for sending to a `chat_id` (receive_id_type, msg_type text/post). Capture syntax.
2. `markdown-to-lark.ts`: minimal transform — keep fenced code, bullet/number lists, bold; escape stray markup.
3. `chunker.ts`: split on Lark limit (use conservative cap), never split inside a code fence; add `(i/n)` headers.
4. `send-reply.ts`: spawn per chunk sequentially; on failure retry (max 3, backoff); final failure → fallback notice.
5. Persist each outbound chunk as a `messages` row (`direction='out'`) + one `audit_log` `reply_sent`.
6. Wire into `index.ts`: ingest → engine → reply, end-to-end.

## Todo List
- [x] Confirm `lark-cli im send` syntax for chat_id target (text + post) — `--as bot --chat-id --markdown --idempotency-key --json`
- [x] `markdown-to-lark.ts` (GFM → Lark-safe) — minimal trim + empty guard; --markdown flag handles rendering
- [x] `chunker.ts` (size split, code-fence-safe, (i/n) headers) — fence-aware flush logic, 9/9 tests pass
- [x] `send-reply.ts` (sequential send + retry + fallback) — argv array, max 3 retries, exp backoff, fallback --text notice
- [x] Persist outbound rows + audit — messages direction='outbound' + audit_log reply_sent/reply_failed
- [x] E2E wire in `index.ts` + `router.ts` — engineCfg + replyCfg passed through; empty-prompt → help line skips engine

## Success Criteria
- @mention in group → Claude reply appears in same chat within timeout.
- Long reply (> limit) arrives as ordered chunks, code blocks intact.
- Transient send failure recovers via retry; hard failure posts a readable fallback + audit row.
- Each reply recorded as outbound message + audit entry.

## Risk Assessment
- **Lark markdown rendering mismatch** → start plain text, iterate to card only if needed (YAGNI).
- **Chunk ordering / interleave** under concurrency → send chunks sequentially per reply.
- **Size limit unknown** → use conservative cap, make configurable.

## Security Considerations
- Never echo Claude output containing secrets to logs verbatim at info level.
- Reply only to the originating `chat_id`; never broadcast.

## Next Steps
MVP (01-04) complete: working @mention chatbot with per-chat memory. Phases 05-07 add the commercial layer.
