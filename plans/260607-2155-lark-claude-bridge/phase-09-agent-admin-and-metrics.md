---
phase: 09
title: "Agent admin UI + accurate token/cost metrics"
status: complete
priority: P1
effort: 1d
depends: [07, 08]
---

# Phase 09 — Agent admin UI + accurate token/cost metrics

## Overview

Two parallel workstreams delivered together:
- **Part A**: Fix token display (was showing only `input_tokens` ~14-54; real total is 100k-400k due to cache), fix cache-hit % formula, add per-agent rollup, add run success/failure tracking.
- **Part B**: Full agent CRUD UI — create/edit/rename/delete/toggle agents from the dashboard; writes to `bridge/agents/` so the running bridge's `fs.watch` hot-reloads in ~300 ms.

## Part A — Token/cost measurement fixes

### Root cause
Dashboard was displaying `input_tokens` (fresh, tiny: 14–54) while real work is in `cache_read_tokens` (43k–344k per run) + `cache_write_tokens`. Cost was already correct (from `total_cost_usd`); only the *display* was wrong.

### Fixes applied

**`dashboard/lib/queries.ts`**
- `getCacheStats()`: added `output_tokens` and `total_tokens = input + output + cache_read + cache_write` to the SELECT.
- **Cache-hit % formula corrected:**
  ```
  OLD (wrong): cache_read / (input + cache_read)          → ~99.96% (ignores cache_write)
  NEW (correct): cache_read / (input + cache_read + cache_write) → ~37.2%
  ```
  With real data (input=16, output=378, cache_read=43930, cache_write=74236):
  `43930 / (16 + 43930 + 74236) = 43930 / 118182 ≈ 37.2%`
- Added `getAgentUsageRollup()`: per-agent token breakdown (input/output/cache_read/cache_write/total) + notional cost, joined via `sessions.agent_id` (primary join) with fallback to `chat_bindings.agent_id`.
- Added `getRunStats(periodDays)`: counts `run_started`, `run_done`, `run_failed` audit events → attempted / succeeded / failed / success_rate.
- Added `getAllAgents()`: returns all agents with `binding_count`.

**`bridge/src/governance/audit-log.ts`**
- Added `"run_failed"` to `AuditEventType` union.

**`bridge/src/engine/index.ts`**
- Wrapped `runWithResume(...)` in try/catch; on error writes `audit(run_failed, {larkMessageId, error})` then re-throws. No `quota_usage` row on failure (no usage data available).

**`bridge/test/governance.test.ts`**
- Extended "writes all supported event types" to include `run_failed`.
- Added dedicated test: `run_failed audit row stores error payload and is queryable`.

**`dashboard/app/insights/page.tsx`** (rewritten)
- Token breakdown section: Fresh input / Cache read / Cache write / Output / Total — 5 stat cards.
- Cache efficiency: updated widget with corrected formula + explanatory note.
- Run success rate: Attempted / Succeeded / Failed / Success rate — 4 stat cards.
- Per-agent usage table: runs + all 4 token types + total + notional cost.
- Existing sections (cohort, risk, stuck, top-spenders) preserved.

## Part B — Agent management UI

### Architecture: where write logic lives

`dashboard/lib/agent-admin.ts` is the single source of truth for filesystem writes. The dashboard API routes import it. The bridge does NOT need to be called — its `fs.watch` on `bridge/agents/` fires within 300 ms of any file change and reloads.

### How agent rename propagates to the running bridge

On rename:
1. DB `agents` row updated in-place (`name` + `folder_path` columns) — stable `id` preserves all `chat_bindings` references.
2. Folder moved via `fs.renameSync`.
3. `agent.json` `name` field updated to new name inside the new folder.
4. The registry's `fs.watch` debounce fires, calls `reloadAgents()`, reads the new folder name, and upserts the existing row (matched by name now = new name).

### Delete safety rule

Delete is refused when:
- The agent is the only enabled agent (`enabled_count <= 1`) — would leave all chats unroutable.
- Deleted regardless of bindings: `chat_bindings` for the deleted agent are removed; sessions are cleared. A previously bound chat will fall back to the default agent on next message.

### Files created/modified

**New files:**
- `dashboard/lib/agent-admin.ts` — CRUD: `createAgent`, `updatePersona`, `updateAllowedTools`, `setEnabled`, `renameAgent`, `deleteAgent`, `readPersona`. Validates `^[a-z0-9-]+$` names.
- `dashboard/app/agents/page.tsx` — server component: lists agents with usage rollup, persona preview, tool chips (write-tools flagged with `!`), action buttons.
- `dashboard/components/agent-actions.tsx` — client island: discriminated union of Create / EditPersona / EditTools / Toggle / Rename / Delete actions with modals.

**Modified files:**
- `dashboard/app/api/agents/route.ts` — expanded: `GET` list, `POST` create, `PATCH` (persona|allowedTools|enabled|rename), `DELETE`. All inputs zod-validated.
- `dashboard/components/sidebar-nav.tsx` — added "Agents" nav item.
- `dashboard/app/insights/page.tsx` — see Part A.
- `dashboard/lib/queries.ts` — see Part A.
- `bridge/src/governance/audit-log.ts` — added `run_failed`.
- `bridge/src/engine/index.ts` — added try/catch with `run_failed` audit.
- `bridge/test/governance.test.ts` — added `run_failed` tests.

## Acceptance results

| Check | Result |
|---|---|
| A1: total_tokens in queries | PASS — includes all 4 token types |
| A1: cache-hit% formula | PASS — denominator = input+cache_read+cache_write; sample: 37.2% not 99.96% |
| A1: per-agent rollup | PASS — `getAgentUsageRollup()` returns rows |
| A1: run success rate | PASS — `getRunStats()` counts run_started/run_done/run_failed |
| A2: run_failed audit | PASS — written on engine error; `npm test` 141/141 green |
| A3: dashboard build | PASS — `npm run build` exits 0, /agents route in output |
| B1: createAgent folder | PASS — agent.json + CLAUDE.md written, invalid name rejected |
| B2: API routes | PASS — POST/PATCH/DELETE all validated and wired |
| B3: E2E test-bot create→delete | PASS — folder created then removed, default/sales intact |
| B4: bridge tests | PASS — 141/141 (was 140/141 before fix) |

## Todo

- [x] Fix `getCacheStats()` — add output_tokens, total_tokens, correct hit% formula
- [x] Add `getAgentUsageRollup()` per-agent query
- [x] Add `getRunStats()` success rate query
- [x] Add `getAllAgents()` helper
- [x] Add `run_failed` to `AuditEventType`
- [x] Write `run_failed` audit in engine error path
- [x] Add `run_failed` test in governance.test.ts
- [x] Update insights/page.tsx with token breakdown + agent table + run stats
- [x] Create `dashboard/lib/agent-admin.ts` with full CRUD
- [x] Expand `dashboard/app/api/agents/route.ts` — GET/POST/PATCH/DELETE
- [x] Create `dashboard/app/agents/page.tsx`
- [x] Create `dashboard/components/agent-actions.tsx` client island
- [x] Add "Agents" to sidebar-nav
- [x] Run `npm test` (bridge) — 141/141 green
- [x] Run `npm run build` (dashboard) — pass
- [x] E2E: create test-bot, verify folder, delete, verify cleanup

## Next steps

- `pm2 restart lark-bridge` after bridge changes take effect.
- Rebuild + restart dashboard to pick up new pages and queries.
