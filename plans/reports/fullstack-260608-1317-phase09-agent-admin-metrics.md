## Phase Implementation Report

### Executed Phase
- Phase: phase-09-agent-admin-and-metrics
- Plan: /Users/lodo/Documents/vibe/LarkCLI/lark-mcp-cli/plans/260607-2155-lark-claude-bridge/
- Status: completed

### Files Modified

**Bridge (bridge/)**
- `src/governance/audit-log.ts` — added `"run_failed"` to AuditEventType union (+1 line)
- `src/engine/index.ts` — wrapped runWithResume in try/catch; writes `run_failed` audit on error (+14 lines)
- `test/governance.test.ts` — added `run_failed` to event-type sweep + dedicated payload test (+15 lines)

**Dashboard (dashboard/)**
- `lib/queries.ts` — total_tokens, corrected cache-hit%, getAgentUsageRollup(), getRunStats(), getAllAgents() (+100 lines)
- `lib/agent-admin.ts` — NEW: full agent CRUD (createAgent/updatePersona/updateAllowedTools/setEnabled/renameAgent/deleteAgent) (~190 lines)
- `app/api/agents/route.ts` — replaced PATCH-only with GET+POST+PATCH(discriminated)+DELETE (~130 lines)
- `app/insights/page.tsx` — rewritten: token breakdown cards, corrected cache widget, run stats, per-agent table (~230 lines)
- `app/agents/page.tsx` — NEW: server component listing all agents with usage+persona+tool chips (~90 lines)
- `components/agent-actions.tsx` — NEW: client island — Create/EditPersona/EditTools/Toggle/Rename/Delete modals (~290 lines)
- `components/sidebar-nav.tsx` — added "Agents" nav item (+1 line)

**Plan docs**
- `plans/260607-2155-lark-claude-bridge/plan.md` — added phase 09 row to table
- `plans/260607-2155-lark-claude-bridge/phase-09-agent-admin-and-metrics.md` — NEW phase file

### Tasks Completed

- [x] A1: queries.ts — total_tokens, fixed cache-hit%, per-agent rollup, run stats
- [x] A2: bridge run_failed audit event + test
- [x] A3: insights page — token breakdown, corrected cache widget, per-agent table, run success rate
- [x] B1: dashboard/lib/agent-admin.ts — full CRUD with path-traversal guards
- [x] B2: /api/agents route — GET/POST/PATCH/DELETE all zod-validated
- [x] B3: /agents page + agent-actions.tsx client island + sidebar entry
- [x] B4: bridge tests 141/141; dashboard build pass; E2E test-bot create→delete clean

### Tests Status
- Bridge typecheck: pass (tsc --noEmit exits 0)
- Bridge unit tests: 141/141 pass (was 140 before; new test added)
- Dashboard build: pass (`npm run build` exits 0, /agents in route table)
- E2E agent-admin: pass (test-bot folder created+deleted, default/sales intact)

### Cache-hit Formula Fix

```
OLD (wrong):   hit% = cache_read / (input + cache_read)
NEW (correct): hit% = cache_read / (input + cache_read + cache_write)
```

With real sample (input=16, cache_read=43930, cache_write=74236):
- Old: 43930 / (16 + 43930) = 43930 / 43946 = **99.96%** (wrong — ignores cache_write)
- New: 43930 / (16 + 43930 + 74236) = 43930 / 118182 = **37.2%** (correct)

The denominator must include cache_write because those tokens were paid at write-time — they count against the "input-side total" budget.

### How Agent CRUD Propagates to Running Bridge

1. Dashboard writes `bridge/agents/<name>/agent.json` and/or `CLAUDE.md` via `agent-admin.ts`
2. Bridge `agent-registry.ts` has a `fs.watch` on `bridge/agents/` with 300 ms debounce
3. Watcher fires → `reloadAgents(db)` → re-scans folders → upserts `agents` table in-place
4. Next incoming message resolves to the updated agent config (model, tools, persona)
5. No bridge restart needed. For DB-only changes (enabled flag), `agent-admin.ts` also updates the `agents` row directly so it takes effect even before the watcher fires.

Rename strategy: update DB row `name+folder_path` in-place first (keeps stable PK → `chat_bindings` unaffected), then `renameSync` the folder, then update `agent.json` name field.

### Issues Encountered

None. One test failure fixed: the `run_failed` test collided with the earlier "all event types" sweep (both wrote `run_failed` rows); fixed by querying on `user_id = 'ou_fail_unique'` to isolate the specific row.

### Next Steps

- **User action required**: `pm2 restart lark-bridge` to pick up engine/audit-log changes
- **User action required**: rebuild + restart dashboard (`npm run build && pm2 restart lark-dashboard` or equivalent) to serve new /agents page and corrected insights

Docs impact: minor — phase-09 file added, plan.md table updated.
