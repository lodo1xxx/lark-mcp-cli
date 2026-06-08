# Live-Test Findings — Lark Claude Bridge

> Bugs surfaced by running the full stack against a REAL Lark group (not unit fixtures).
> Date: 2026-06-08. All fixed + unit-tested. 136 logic tests pass, 0 fail.

## Context
After 8 phases (136 tests green), launched bridge + dashboard live. Real group traffic + a stale
overnight session exposed 4 issues invisible to fixtures. Documented here as the value of real testing.

## Bugs found & fixed

### 1. status.json path off-by-one → dashboard showed "offline"
- **Cause**: `status-writer.ts` wrote `../../../data/status.json` (3 levels = repo root) instead of
  `../../data/status.json` (bridge/data). Dashboard read the right path but got a stale test fixture.
- **Fix**: corrected path. Live gauges now flow bridge→dashboard (`online:true`, real uptime/pid).
- **Class**: same "3-vs-2 level" path bug hit twice before (client.ts, AGENTS_DIR) — a recurring footgun.

### 2. Bot replied to EVERY group message (spam risk) 🔴
- **Cause**: filter assumed "group event ⟹ bot @mentioned" (Lark auto-filter). FALSE for this group —
  it grants the bot "receive all messages", so the bot received plain chatter ("xong", "ae đi nha…"),
  `@_all`, and `@other-person` — and tried to answer all.
- **Fix**: `event-filter.ts` now REQUIRES `content` to contain the bot token `@<botDisplayName>`; drops
  @all / @others / plain text. Added `mentionsBot()`; `stripMentionPrefix()` removes the token anywhere
  (not just leading). +4 unit tests with the real captured messages.
- **Lesson**: the earlier "Lark auto-filters mentions" assumption (plan §RISK#2) is config-dependent and
  must NOT be relied on — verify the mention token ourselves.

### 3. Expired session not recovered → every reply in that chat failed 🔴
- **Cause**: overnight the stored `claude_session_id` died. Claude errors `No conversation found with
  session ID: <id>`. The runner's classifier regex (`/session.*(not found|expired)/`) did NOT match
  (the words appear as "…found … session ID"), so it fell through to SPAWN_FAILED. resume-strategy only
  retries on SESSION_LOST → never recovered → chat permanently stuck.
- **Fix**: added `/no conversation found with session/i` to the SESSION_LOST classifier. Now expired
  session → SESSION_LOST → resume-strategy retries fresh → new session_id stored.
- **Resolves plan Q3**: sessions DO expire across long gaps; auto-recovery now handles it (no transcript
  fallback needed).

### 4. Duplicate "default" agent → router vs engine disagreed
- **Cause**: phase-01 seed inserted a "Default Agent" (id 1, empty folder_path) AND phase-05 registry
  created folder agent "default" (id 2). Router's id-ASC fallback picked the bare seed (id 1, no
  persona/allowlist); engine's resolve-agent picked the folder "default" (id 2). Two sources of truth.
- **Fix**: removed agent seeding from `seed.ts` (registry owns agents by scanning `bridge/agents/`).
  Deleted the vestigial row. Router id-ASC fallback now → folder "default" (id 2), matching the engine.
- **Lesson**: single source of truth for agents = the folder registry; seed only the project.

## Net result
- Bot now: ignores non-@bot group chatter, replies only to real @mentions, recovers expired sessions,
  and runs the folder "default" agent (persona + tool allowlist) for unbound chats.
- Tests: 136 pass / 0 fail / 4 cancelled (the cancelled = live-Claude integration tests that time out
  under full-suite parallelism — pre-existing, documented phase-06, not a regression).

## Unresolved questions
1. Multi-app routing (one process N apps vs one consume-child per app) — still MVP=1 app.
2. Safe `engine_concurrency` above 1 — needs a real soak against the OAuth 5h window.
3. Non-text messages (images/files/post) are dropped — revisit if rich input needed.
