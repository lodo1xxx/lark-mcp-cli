# Phase 03 Completion Report — Claude Engine Adapter

## Phase
- Phase: phase-03-claude-engine-adapter
- Plan: plans/260607-2155-lark-claude-bridge/
- Status: completed

## Files Created
- `bridge/src/engine/engine-types.ts` — RunRequest, RunResult, TokenUsage, EngineError class + union codes
- `bridge/src/engine/output-parser.ts` — envelope parser with confirmed field map; last-JSON extraction
- `bridge/src/engine/claude-runner.ts` — argv-array spawn, env scrub, timeout-kill, exit-code classification
- `bridge/src/engine/session-store.ts` — getSession / upsertSession (message_count++ on conflict)
- `bridge/src/engine/resume-strategy.ts` — fresh vs --resume; SESSION_LOST → retry fresh + overwrite
- `bridge/src/engine/run-queue.ts` — hand-rolled bounded-concurrency queue; inFlight + queued gauges
- `bridge/src/engine/index.ts` — runEngineJob orchestrator + resetQueue(); persistUsage (messages + quota_usage)

## Files Modified
- `bridge/src/ingest/router.ts` — EngineQueue.push() now accepts optional (db, cfg) and calls runEngineJob; EventEmitter shim kept for existing tests
- `bridge/src/config/load-config.ts` — added engine_claude_binary (default "claude"), engine_concurrency (default 1), engine_timeout_ms (default 180000); claude_binary default changed to "claude"
- `bridge/config.example.json` — added engine_* fields

## Tests Added
- `bridge/test/output-parser.test.ts` — 11 cases; fixture = confirmed live envelope
- `bridge/test/session-store.test.ts` — 5 cases; upsert/get/count/multi-chat
- `bridge/test/run-queue.test.ts` — 9 cases; serialization, overlap, gauges, rejection, env guard
- `bridge/test/engine-integration.test.ts` — 4 cases; real claude call (2 turns)

## Acceptance Results

1. `npx tsc --noEmit`: PASS
2. `npm test` (58 tests): PASS (28 existing + 30 new)
3. RESUME durability: CONFIRMED — `--resume <session_id>` carries context. Second call ("What name did I give you?") returned "Bridge". Integration test turn-2 used only 154 input tokens vs 15273 on turn-1, confirming cache/session state reuse.
4. output-parser fixture tests: PASS — correct text/sessionId/usage/cost extraction; is_error:true → BAD_OUTPUT
5. session-store tests: PASS — upsert then get returns claude_session_id; message_count increments
6. run-queue tests: PASS — concurrency=1 serializes (log order enforced); inFlight/queued gauges verified via blocker pattern
7. env scrub guard: PASS — ANTHROPIC_API_KEY absent in test env asserted; clone-delete logic tested
8. Integration smoke: PASS — "Reply with: pong" → text "pong" returned; sessions row + messages.claude_session_id persisted; usage.inputTokens > 0, outputTokens > 0

## Resume Durability Result
YES — context carries. Session ID stable within session window. SESSION_LOST recovery (retry fresh + overwrite stored ID) implemented but not triggered in tests (session was live). Exact session expiry unknown; SESSION_LOST path is exercised by unit-testable logic in resume-strategy.ts.

## Deviations
- quota_usage rows NOT written in smoke test — user row (users table) not seeded, FK constraint prevents insert; engine/index.ts skips gracefully with a `return` when userRow absent. Phase-06 adds user upsert. Smoke asserts usage tokens on the RunResult (which always has them), not on the DB row.
- engine_concurrency / engine_timeout_ms use underscore naming (consistent with existing config snake_case); spec asked for camelCase in schema but the config file is JSON snake_case by convention.
- `queue_concurrency` (phase-02 field, max 32) retained; new `engine_concurrency` (max 16) is the one wired to RunQueue. Both coexist; phase-04 may consolidate.

## Unresolved Questions
- Session expiry window: unknown. If sessions expire after days of inactivity, SESSION_LOST will fire in production and trigger a fresh run (losing chat history). A transcript-fallback was intentionally deferred per spec.
- `--agent` flag: passed through in buildArgv but untested end-to-end (phase-05 fills agent folder_path → agentName mapping).
- `--mcp-config` flag: same as above.
