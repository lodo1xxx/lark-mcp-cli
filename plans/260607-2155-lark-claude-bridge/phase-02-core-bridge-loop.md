# Phase 02 — Core Bridge Loop (event consume → filter → dedup → route)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-01](phase-01-scaffold-schema-config.md)
- Grounding: `../reports/analysis-260607-1706-claude-bridge-reverse-engineering.md` (event WS long-conn)
- Repo evidence: `internal/event/source/feishu.go` ("feishu-websocket"), `cmd/event/consume.go`

## Overview
- **Priority**: P1
- **Status**: complete
- **Effort**: 1.5d
- Spawn `lark-cli event consume im.message.receive_v1` as a long-lived child process, parse NDJSON
  line-by-line, filter to **@mention-in-group only**, dedup by `lark_message_id`, then hand off to router.

## Key Insights
- `lark-cli event consume` streams **one JSON object per line (NDJSON)** over WS long-conn → no public URL,
  runs on localhost. Confirmed flags: `--as`, `--jq`, `--max-events`, `--timeout`, `--output-dir`.
- Use `--jq` for a coarse server-side prefilter (message events) but do the **mention + group** decision in TS
  where we have the bot's open_id and full payload — keep logic in one place (DRY).
- Lark **redelivers** events → dedup on `message_id` via the UNIQUE constraint (INSERT OR IGNORE → if 0 rows changed, skip).
- This phase does NOT call Claude — it only validates, persists inbound `messages`, and emits a routed job.
  Engine call is phase-03; wiring them is phase-04. Keeps each unit testable.

## Requirements
**Functional**
- Long-running child `lark-cli event consume im.message.receive_v1 --as bot` (NO `--max-events`/`--timeout` in prod).
- Robust NDJSON line reader (handle partial lines across chunk boundaries).
- Filter: keep only if `chat_type == group` AND bot is in `message.mentions`.
- Dedup: `INSERT OR IGNORE INTO messages(lark_message_id,...)`; skip if already seen.
- Resolve `chat_id → chat_binding → agent` (default agent if unbound). Emit a `RoutedJob` to the engine queue.
- Child-process supervision: auto-restart on exit/crash with backoff (full supervision in phase-08).

**Non-functional**
- Backpressure-safe: if engine queue is full, still ack/persist the message; queueing handled in phase-03.
- Files < 200 lines.

## Architecture
```
bridge/src/
  ingest/
    consume-process.ts     # spawn lark-cli, pipe stdout, restart w/ backoff
    ndjson-reader.ts       # buffer chunks → emit complete JSON lines
    event-filter.ts        # group? + bot-mentioned? → bool
    dedup.ts               # INSERT OR IGNORE messages, returns isNew
    router.ts              # chat_id → binding → agent; build RoutedJob
  bot/
    bot-identity.ts        # fetch + cache bot open_id (via lark-cli) for mention match
  types/
    routed-job.ts          # { chatId, projectId, agentId, userId, text, larkMessageId }
```
Flow: `consume-process` → `ndjson-reader` → `event-filter` → `dedup` → `router` → (engine queue, phase-03).

### @mention detection (resolve unresolved Q5)
- Step 1 samples a real `im.message.receive_v1` payload; expected:
  `event.message.mentions[]` with `id.open_id`/`id.union_id` and a `key` like `@_user_1`.
- Match when any `mentions[].id.open_id == botOpenId`. Strip the mention token from text before sending to Claude.

## Related Code Files
**Create**: `bridge/src/ingest/consume-process.ts`, `ndjson-reader.ts`, `event-filter.ts`, `dedup.ts`,
`router.ts`, `bridge/src/bot/bot-identity.ts`, `bridge/src/types/routed-job.ts`.
**Modify**: `bridge/src/index.ts` (wire ingest pipeline on boot).
**Delete**: none.

## Implementation Steps
1. **Sample payload**: run `lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 60s`,
   send a test @mention, capture JSON → document mention + chat_type + message_id paths. (Resolves Q5.)
2. `bot-identity.ts`: get bot open_id (via lark-cli / config), cache in memory + DB.
3. `ndjson-reader.ts`: chunk buffer, split on `\n`, JSON.parse each complete line, skip blanks.
4. `consume-process.ts`: `spawn` lark-cli, pipe stdout→reader, stderr→log; on exit restart with exp backoff (cap 30s).
5. `event-filter.ts`: return true only for group + bot-mentioned; unit-test with the sampled fixture.
6. `dedup.ts`: `INSERT OR IGNORE`; return whether row was new; persist inbound message.
7. `router.ts`: look up `chat_bindings` by `chat_id`; fallback default agent; build `RoutedJob`; push to engine queue (stub now).
8. Wire all in `index.ts`; log a one-line trace per accepted message.

## Todo List
- [x] Sample + document `im.message.receive_v1` payload — OVERRIDE: payload confirmed via live capture (no mentions[] array; group delivery implies @mention)
- [x] `bot-identity.ts` — simplified to bot display name provider from config (no open_id fetch needed)
- [x] `ndjson-reader.ts` (partial-line-safe)
- [x] `consume-process.ts` (spawn + restart backoff, stdin kept open)
- [x] `event-filter.ts` (group + text only; mention strip via stripMentionPrefix) + fixture tests
- [x] `dedup.ts` (INSERT OR IGNORE, isNew)
- [x] `router.ts` (binding→agent, default agent fallback, RoutedJob, engineQueue stub)
- [x] Wire pipeline in `index.ts`; trace log per accepted msg

## Success Criteria
- @mention in a group → exactly one `messages` row, one routed job, one trace log.
- P2P message or group message without mention → dropped (no row, no job).
- Duplicate redelivered `message_id` → ignored (still 1 row).
- Killing the child process → auto-restart within backoff; stream resumes.

## Risk Assessment
- **Mention payload shape differs from assumption** → mitigate via step-1 live sampling before coding filter.
- **NDJSON partial lines** → covered by buffered reader + test.
- **Child silently dies** (WS drop) → supervision + heartbeat log; deeper handling phase-08.

## Security Considerations
- Run consume `--as bot`; never log full payloads at info level (may contain PII) — debug-gated.
- Drop everything that is not a bot-mention-in-group early (least surface).

## Next Steps
Emits `RoutedJob` consumed by phase-03 engine queue. Reply wiring in phase-04.
