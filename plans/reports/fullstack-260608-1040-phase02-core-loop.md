# Phase 02 Completion Report — Core Bridge Loop

Date: 2026-06-08
Status: COMPLETE

## Files Created
- `bridge/src/types/routed-job.ts` (18 lines) — RoutedJob interface
- `bridge/src/bot/bot-identity.ts` (21 lines) — bot display name provider from config
- `bridge/src/ingest/ndjson-reader.ts` (55 lines) — partial-line-safe chunk buffer
- `bridge/src/ingest/event-filter.ts` (82 lines) — filter + stripMentionPrefix + isLarkEvent type-guard
- `bridge/src/ingest/dedup.ts` (52 lines) — INSERT OR IGNORE, returns isNew + messageId
- `bridge/src/ingest/router.ts` (80 lines) — chat_bindings lookup → default agent fallback → engineQueue stub
- `bridge/src/ingest/consume-process.ts` (95 lines) — spawn + exp backoff restart (1s→30s cap), stdin kept open
- `bridge/test/event-filter.test.ts` — 14 unit tests
- `bridge/test/dedup.test.ts` — 5 unit tests
- `bridge/test/router.test.ts` — 5 unit tests
- `bridge/test/pipeline-smoke.test.ts` — 4 integration tests

## Files Modified
- `bridge/src/index.ts` — wired full pipeline (consume→filter→dedup→route) with graceful shutdown
- `bridge/src/config/load-config.ts` — added `bot_display_name` field (default "Bot")
- `bridge/config.example.json` — added `bot_display_name` example key
- `bridge/package.json` — added `test` and `typecheck` scripts

## Acceptance Results
1. `npx tsc --noEmit` — PASS (no errors)
2. event-filter + mention-strip unit tests — PASS (14/14): group+text+fixture accepted, prompt="tính 2+2"; p2p dropped; group non-text dropped
3. dedup unit tests — PASS (5/5): same lark_message_id → isNew true then false, 1 row in messages
4. router unit tests — PASS (5/5): known chat_binding → bound agent; unknown chat_id → default agent
5. Integration smoke test — PASS (4/4): fixture JSON → 1 messages row + 1 RoutedJob, correct fields; redelivery → no extra row/job
6. Live spawn test — PASS: `feishu-websocket: connected` confirmed within 8s; clean stop

Total: 28/28 tests pass

## Key Deviations from Spec
- **mentions[] approach replaced**: Spec assumed `event.message.mentions[]` for bot detection. Override applied: group delivery already implies @mention; filter uses `chat_type === "group"` only.
- **bot-identity.ts simplified**: Demoted from open_id fetcher to a config-backed display name provider. No lark-cli API calls needed.
- **stripMentionPrefix added**: Removes leading `@<botName>` token from content (case-insensitive, handles multi-word names with spaces).
- **Schema exec fix in tests**: Simple semicolon-split of schema.sql failed due to semicolons in SQL comments. Fixed by filtering PRAGMA lines and calling `db.exec()` on full DDL string.

## Unresolved Questions
- None for this phase. Phase-03 replaces the engineQueue stub with a real bounded queue + Claude invocation.
