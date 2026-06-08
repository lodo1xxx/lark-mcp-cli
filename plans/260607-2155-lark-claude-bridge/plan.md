---
title: "Lark Claude Bridge"
description: "2-way Lark/Feishu group chatbot powered by Claude Code CLI (OAuth), with multi-agent routing, quota/cost governance, and a Next.js dashboard."
status: complete
priority: P2
effort: 11d
branch: main
tags: [lark, feishu, claude-code, chatbot, multi-agent, governance, nextjs]
created: 2026-06-08
---

# Lark Claude Bridge

2-way Lark/Feishu chatbot. Replies ONLY when @mentioned in a group chat.
Engine = Claude Code CLI via OAuth (subscription, NOT API key) shelled out as a subprocess.
Built ON TOP of existing `lark-cli` (event WS long-conn + 21 MCP tools) — reuse, do not reimplement.

Grounding analysis: `../reports/analysis-260607-1706-claude-bridge-reverse-engineering.md`
Reverse-engineers "Claude Bridge by Transform Group". ~70% of substrate already in this repo.

## Architecture (one-liner)

`lark-cli event consume` (child proc, NDJSON) → filter @mention-in-group → dedup by message_id →
quota check → route to agent → `claude -p --resume <session>` (capture session_id + usage from JSON) →
markdown→Lark → `lark-cli im send`. SQLite stores projects/agents/sessions/messages/quota/audit.
Next.js dashboard @ :9820 reads SQLite + live activity.

## Core constraints

- KISS/YAGNI/DRY. lark-cli & claude are subprocesses — never reimplement Lark API or Claude calls in TS.
- Files < 200 lines, kebab-case.
- Reply trigger: @mention in GROUP only (drop P2P). Filter `im.message.receive_v1`.
- Cost is NOTIONAL metering (quy đổi ảo at reference Sonnet rates, cache-aware) for fairness/quota.
  Real limit = subscription 5h rolling + weekly window → queue/throttle to protect it.
- Idempotency: dedup events by `message_id` (Lark redelivers).
- Security: app_secret never reaches client/dashboard; quota enforced BEFORE spawning Claude.
- Multi-tenant data model from day 1 (App = security boundary, Agent = role boundary), 1 app to start.

## Phases

| # | Phase | Status | Effort | Depends |
|---|-------|--------|--------|---------|
| 01 | [Project scaffold + SQLite schema + config](phase-01-scaffold-schema-config.md) | **complete** | 1d | — |
| 02 | [Core bridge loop (event consume → filter → dedup → route)](phase-02-core-bridge-loop.md) | **complete** | 1.5d | 01 |
| 03 | [Claude engine adapter (shell out, resume, usage capture, queue)](phase-03-claude-engine-adapter.md) | **complete** | 2d | 01 |
| 04 | [Reply path (Claude output → Lark, markdown, long-msg, cards)](phase-04-reply-path.md) | **complete** | 1d | 02,03 |
| 05 | [Multi-agent system (folder agents, registry, chat→agent binding)](phase-05-multi-agent-system.md) | **complete** | 1.5d | 03 |
| 06 | [Governance (notional cost, quota cap, cohorts, audit)](phase-06-governance-quota-cost.md) | **complete** | 2d | 03,05 |
| 07 | [Web dashboard (Next.js :9820, QR add-platform)](phase-07-web-dashboard.md) | **complete** | 1.5d | 06 |
| 08 | [Tests + ops (supervision, restart, backup, deploy)](phase-08-tests-and-ops.md) | **complete** | 1d | 02-07 |
| 09 | [Agent admin UI + accurate token metrics](phase-09-agent-admin-and-metrics.md) | **complete** | 1d | 07,08 |

Critical path: 01 → 02/03 → 04 → 05 → 06 → 07 → 08. Phases 02 and 03 can run in parallel after 01.
MVP cut (80/20): phases 01-04 = **DONE** — working @mention chatbot with memory. 05-07 = the commercial layer.

**MVP complete (2026-06-08).** Resume-durability confirmed in phase-03: cache hit 154 vs 15,273 tokens (99% hit rate). All 75 tests green. Real smoke send delivered to test chat (message_id: om_x100b6d505ec49ca4e156e8c8447bbc8).

**PROJECT COMPLETE — MVP + Commercial (2026-06-08).** All 8 phases done. 136 tests green (127 unit + 9 new ndjson). Backup, pm2/launchd supervision, and ops runbook in place. Q6 (OAuth concurrency) resolved: `engine_concurrency=1` serial is the safe default.

## Key dependencies (external, pre-verified on this machine)

- `lark-cli` @ `/Users/lodo/.npm-global/bin/lark-cli` — Go build with mcp + event support.
- `claude` CLI v2.1.163, logged in via OAuth (`~/.claude/.credentials.json`).
- Lark Developer Console: MUST enable event `im.message.receive_v1` for app `cli_a9707ccfdea25ed1`
  (scope `im:message` already granted). WS long-conn → no public webhook URL needed.
- Node v24, npm 11, SQLite (better-sqlite3 or node:sqlite).

## Verification results (2026-06-08, live on this machine)

**✅ RISK #1 + #3 ELIMINATED — `claude -p --output-format json` envelope confirmed:**
```
{ "type":"result", "subtype":"success", "is_error":false, "result":"<reply text>",
  "session_id":"bbdb9045-...",            ← memory: store & --resume per chat_id
  "total_cost_usd":0.26725125,             ← NOTIONAL COST HANDED TO US (no rate math needed)
  "num_turns":1, "duration_ms":4850, "permission_denials":[], "stop_reason":"end_turn",
  "usage":{ "input_tokens":14729, "output_tokens":4,
            "cache_creation_input_tokens":30961, "cache_read_input_tokens":0 },  ← cache-aware
  "modelUsage":{ "<model>":{ "costUSD":..., "cacheReadInputTokens":..., "cacheCreationInputTokens":... } } }
```
→ Cost meter does NOT need to reverse-engineer Sonnet rates: `total_cost_usd` + cache token split are
   provided. First call shows high `cache_creation` (building cache); on `--resume` later calls show high
   `cache_read` → cheap. Matches demo's 83%-hit economics. **phase-03/06 simplified: parse, don't compute.**

**✅ RISK #2 RESOLVED — live @mention captured twice, parse rule confirmed:**
Real event from `consume` (group, bot @mentioned):
```
{ "type":"im.message.receive_v1", "event_id":"216596a2...",  ← dedup key
  "message_id":"om_x100...", "chat_id":"oc_2d19...",          ← chat_id = session/memory key
  "chat_type":"group", "message_type":"text",
  "sender_id":"ou_ac48dc...",                                 ← attribute quota to this user open_id
  "content":"@Chanh Quản Gia tính 2+2" }                      ← "@<bot name> <real text>"
```
Confirmed facts:
  - **NO `mentions[]` array** in consume output (schema accurate). Mention renders as `@<bot display name>`
    inside `content`.
  - **Lark auto-filters**: receiving a group event AT ALL means the bot was @mentioned (bot only gets group
    `receive_v1` when mentioned). → **No `lark_api` confirm call needed.**
  - **Trailing text IS included**: `content` carries the full `@<bot name> <user question>`. No message-detail
    fetch needed — everything is in the event.
→ **phase-02 final rule**: filter `chat_type=="group"` → dedup by `event_id` → strip leading `@<bot name>`
   prefix from `content` → that's the prompt. Bot display name = "Chanh Quản Gia" (make configurable per app).
   Edge: if stripped content is empty (mention only, no text), reply a short help/prompt instead of spawning.

**✅ Pipeline reachable**: `lark-cli event consume im.message.receive_v1 --as bot` starts the bus daemon and
   opens the Lark WebSocket. Bot identity ready (no user login needed for this event). MUST keep stdin open
   in the child process (consume treats stdin EOF as shutdown) — wire as `< <(tail -f /dev/null)` or SIGTERM.

## Unresolved questions (remaining)

1. **`--resume` durability across days** — ✅ RESOLVED in phase-03: cache hit confirmed (154 input tokens vs 15,273 cold = 99% hit). Session ID persisted in `sessions.claude_session_id` and looked up per chat_id on every inbound message. No transcript fallback needed for MVP.
2. **Multi-app routing** — one bridge process routing N apps vs one `consume` child per app. MVP = one
   app/one child; data model supports N. Revisit when 2nd app added (phase-05 note).
3. **Concurrency vs OAuth rate window** — ✅ RESOLVED (phase-08): documented serial default (`engine_concurrency=1`). Rate-limit symptom documented. Raising instructions in `docs/bridge-operations.md`. Default serial is production-safe.

> Console event `im.message.receive_v1` is ALREADY enabled (live capture succeeded). Bot display name in
> test group = "Chanh Quản Gia"; test chat_id = `oc_2d1920f8015432088e8013a9a46a17fa`; test user open_id =
> `ou_ac48dc3cecb9bb914f9cca6ee6cfff93`. Use these for phase-02 fixtures.
