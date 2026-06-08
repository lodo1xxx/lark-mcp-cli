# Phase 06 Governance — Completion Report

**Date**: 2026-06-08
**Status**: complete

## Files Created
- `bridge/src/governance/rate-table.ts` (38 lines) — per-Mtok NOTIONAL rates, `computeNotionalCost()`
- `bridge/src/governance/cost-meter.ts` (27 lines) — `priceRun()`: prefer total_cost_usd, fallback rate-table
- `bridge/src/governance/quota-store.ts` (96 lines) — upsertUser, getUsageToday, setQuotaCap, updateUserCohort
- `bridge/src/governance/quota-gate.ts` (50 lines) — `checkQuota()`, DenyReason enum
- `bridge/src/governance/audit-log.ts` (34 lines) — typed `audit()` writer, 8 event types
- `bridge/src/governance/cohort-classifier.ts` (105 lines) — `classifyUser()` pure fn + `runClassifier()` DB sweep
- `bridge/src/governance/auto-tighten.ts` (89 lines) — `maybeTighten()`, `resetQuotaCap()`, `runAutoTightenSweep()`
- `bridge/src/governance/scheduler.ts` (86 lines) — `start()/stop()` setInterval cron
- `bridge/test/governance.test.ts` (290 lines) — 32 tests covering all acceptance criteria

## Files Modified
- `bridge/src/engine/index.ts` — upsertUser, priceRun, audit(run_started), audit(run_done) wired; `persistUsage` now always writes quota_usage
- `bridge/src/ingest/router.ts` — quota gate before engine spawn; polite deny reply; audit(msg_in, quota_denied)
- `bridge/src/config/load-config.ts` — added: daily_message_cap, rate_table, classifier_interval_ms, auto_tighten, stuck_nudge_enabled schemas
- `bridge/config.example.json` — added governance section with defaults

## Acceptance Results
1. `npx tsc --noEmit`: PASS (clean)
2. `npm test`: 126 pass, 0 fail, 1 cancelled (engine-integration live-Claude timeout — PRE-EXISTING, confirmed by git stash check)
3. cost-meter: provided total_cost_usd → `source=claude_provided`; zero → `source=rate_table`; cache_read ~10× ratio: PASS
4. quota-gate: under cap → allow; at/over 50 msgs → OVER_DAILY_CAP; disabled cohort → DISABLED; auto-tightened cap → AUTO_TIGHTENED: PASS
5. quota-store: upsertUser idempotent; getUsageToday sums today only (not yesterday): PASS
6. cohort-classifier: all 5 cohorts hit with synthetic stats; risk_score monotonic with deny rate: PASS
7. auto-tighten: spam stats (15 msgs + 40% deny) → cap reduced + audit row; normal stats → no change; resetQuotaCap → null: PASS
8. audit-log: typed rows; payload JSON round-trips; all 8 event types write without error: PASS
9. integration smoke: upsert→quota-check→price→persist→audit lifecycle, all rows verified: PASS

## Notional Cost Decision
- **Primary**: `RunResult.notionalCostUsd` (= Claude's `total_cost_usd`) — accurate, cache-aware, no math needed
- **Fallback**: `computeNotionalCost(usage, rateTable)` — used when `total_cost_usd` is 0 or absent
- Live fixtures ($0.132159 first call, $0.012094 resume) pass `first > second` + sane range checks
- cache_read defaults to 0.30/Mtok = exactly 10× cheaper than input (3.0/Mtok)

## Cohort Thresholds Chosen
- power: ≥20 total msgs + ≥5 today + ≤10% deny
- spam_prone: ≥10 total msgs + ≥30% deny
- stuck: ≥3 total msgs + ≥50% repeat rate
- dormant: ≥7 days since last message
- normal: default

All conservative — err toward "normal". repeat_rate hardcoded 0 pending content analysis (YAGNI).

## Deviations from Spec
- `repeat_rate` in runClassifier always 0 (content similarity requires ML/levenshtein — deferred per YAGNI; test covers it via pure classifyUser() which uses the field correctly)
- `scheduler.ts` uses lazy `await import()` for send-reply to avoid circular dep at startup
- audit_log.user_id for quota_denied uses lark_user_id string (not numeric FK) matching schema column type TEXT

## Unresolved Questions
- None blocking. repeat_rate computation deferred to phase-07 if needed.
