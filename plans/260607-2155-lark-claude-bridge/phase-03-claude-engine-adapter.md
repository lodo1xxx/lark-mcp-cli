# Phase 03 — Claude Engine Adapter (shell out, resume, usage capture, queue)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-02](phase-02-core-bridge-loop.md)
- Grounding: `../reports/analysis-260607-1706-claude-bridge-reverse-engineering.md` (engine OAuth, cost model)

## Overview
- **Priority**: P1
- **Status**: complete
- **Effort**: 2d
- Shell out to `claude -p` (OAuth subscription, NO API key). Per `chat_id`: first run captures `session_id`;
  subsequent runs use `--resume <session_id>`. Capture token `usage` from `--output-format json`.
  Serialize runs through a concurrency queue to protect the 5h OAuth rate window.

## Key Insights
- Engine = `claude` CLI v2.1.163. With no `ANTHROPIC_API_KEY`, it uses `~/.claude/.credentials.json` (OAuth).
  **Must spawn with `ANTHROPIC_API_KEY` unset** so it stays on subscription, not API billing.
- Memory = Claude session resume. Map `chat_id ↔ claude_session_id` in `sessions`. New chat → plain `claude -p`,
  parse `session_id` from JSON; next turns → `claude --resume <id> -p`.
- `--output-format json` returns a single result envelope; **assume** `{ session_id, usage{...}, total_cost_usd, result }`.
  Exact field names are unresolved (Q1/Q2) → **step 1 samples a live run and pins the parser** before anything else.
- Cost is NOTIONAL only (phase-06 prices it). This phase just **captures raw usage** and stores it on the message.
- OAuth has a 5h rolling + weekly rate window. Protect it: a queue with configurable concurrency (start = 1, serial).
  Reject/deny is cheaper than burning quota → quota check (phase-06) happens BEFORE enqueue.

## Requirements
**Functional**
- `runClaude({ prompt, sessionId?, agentName?, mcpConfigPath?, model, effort, cwd })` →
  spawn `claude -p --output-format json [--resume <id>] [--agent <name>] [--mcp-config <path>]`.
- Parse result: extract `result` text, `session_id`, and usage token counts.
- Persist/update `sessions.claude_session_id` keyed by `chat_id`.
- Timeout (configurable, e.g. 180s) → kill child, return typed error.
- Concurrency queue (size from config) + per-run trace; surface "in-flight" count for dashboard.
- Typed errors: `RATE_LIMITED`, `TIMEOUT`, `SESSION_LOST`, `SPAWN_FAILED`, `BAD_OUTPUT`.

**Non-functional**
- Never leak OAuth creds to logs. Files < 200 lines.

## Architecture
```
bridge/src/engine/
  claude-runner.ts        # spawn claude -p, env scrub (unset ANTHROPIC_API_KEY), collect stdout
  output-parser.ts        # parse --output-format json → { text, sessionId, usage }
  session-store.ts        # chat_id ↔ claude_session_id (read/write sessions table)
  run-queue.ts            # p-queue / hand-rolled: concurrency=config, in-flight gauge
  engine-types.ts         # RunRequest, RunResult, EngineError union
  resume-strategy.ts      # decide: fresh vs --resume; handle SESSION_LOST → fresh + flag
```
Flow (from phase-02 RoutedJob): `run-queue.enqueue` → quota gate (phase-06 hook) → `resume-strategy` →
`claude-runner` → `output-parser` → persist usage + session_id → return text (to phase-04 reply path).

## Related Code Files
**Create**: `bridge/src/engine/claude-runner.ts`, `output-parser.ts`, `session-store.ts`, `run-queue.ts`,
`engine-types.ts`, `resume-strategy.ts`.
**Modify**: `bridge/src/ingest/router.ts` (push RoutedJob into run-queue).
**Delete**: none.

## Implementation Steps
1. **Sample a live run** (resolves Q1/Q2/Q3): `claude -p "hello" --output-format json` → record exact JSON keys
   for session_id, usage (input/output/cache_read/cache_write), cost. Then a 2nd run with `--resume <id>` to
   confirm context carries. Document field map in `output-parser.ts` header comment.
2. `claude-runner.ts`: spawn with env where `ANTHROPIC_API_KEY` deleted; capture stdout fully; enforce timeout (kill on overrun).
3. `output-parser.ts`: parse JSON envelope per step-1 map; tolerate stream-json fallback; throw `BAD_OUTPUT` if unparseable.
4. `session-store.ts`: upsert `sessions(chat_id, claude_session_id, last_active_at, message_count++)`.
5. `resume-strategy.ts`: if `sessions` has id → `--resume`; on `SESSION_LOST` (resume error) → retry fresh, mark new id.
6. `run-queue.ts`: bounded-concurrency queue (config `engineConcurrency`, default 1); expose `inFlight` + `queued` gauges.
7. Map non-zero exit / known stderr patterns → `RATE_LIMITED` vs `SPAWN_FAILED`; backoff on `RATE_LIMITED`.
8. Integration smoke: RoutedJob → queue → run → returns text + persisted usage + session_id.

## Todo List
- [x] Sample live `claude -p --output-format json` (+ `--resume`) → pin field map (Q1/Q2/Q3)
- [x] `claude-runner.ts` (env scrub, spawn, timeout-kill)
- [x] `output-parser.ts` (json envelope → text/session/usage)
- [x] `session-store.ts` (chat_id ↔ session upsert)
- [x] `resume-strategy.ts` (fresh vs resume, SESSION_LOST recovery)
- [x] `run-queue.ts` (bounded concurrency + gauges)
- [x] Typed `EngineError` union + stderr classification
- [x] Smoke: RoutedJob → text + usage + session persisted

## Success Criteria
- First message in a new chat → fresh run, `session_id` stored.
- Follow-up message → `--resume` reuses context (Claude references prior turn).
- Every run persists usage tokens (incl. cache read/write) on the message row.
- Concurrency=1 serializes runs; `inFlight`/`queued` gauges readable.
- Timeout and rate-limit produce typed errors, not crashes.

## Risk Assessment
- **JSON field names differ from assumption** (Q1) → step-1 live sampling gates all parsing code.
- **Resume context loss over days** (Q3) → SESSION_LOST recovery + optional transcript fallback (decide after soak).
- **OAuth rate exhaustion** → serial queue + backoff; expose rejects to dashboard (phase-06/07).
- **Accidental API billing** → assert `ANTHROPIC_API_KEY` unset before every spawn (test guard).

## Security Considerations
- Scrub env so OAuth creds path is the only auth; never echo `~/.claude/.credentials.json`.
- Run each agent with a constrained `cwd` (phase-05 sets agent folder); no shell string interpolation — use argv array.

## Next Steps
Returns text + usage to phase-04 (reply) and phase-06 (notional cost/quota). Agent/mcp args filled by phase-05.
