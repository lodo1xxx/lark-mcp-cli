# Phase 06 — Governance (notional cost, quota cap, cohorts, audit)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-05](phase-05-multi-agent-system.md)
- Grounding: analysis "Governance layer" (cohorts, quota auto-tighten, risk score) + "Cost model"

## Overview
- **Priority**: P2 (the commercial core — what CLI alone can't do)
- **Status**: complete
- **Effort**: 2d
- Convert captured token usage into a NOTIONAL cost (quy đổi ảo at reference Sonnet rates, cache-aware),
  enforce per-user quota caps BEFORE spawning Claude, classify users into cohorts, auto-tighten on spam,
  and write a full audit trail.

## Key Insights
- Cost is **notional**: real limit is the OAuth subscription 5h/weekly window, not dollars. The $ figure is a
  **fairness/quota unit** (like the demo's "20 msg = $0.11"). Price input/output/cache tokens at reference
  Sonnet rates; **cache-read ~10× cheaper** (demo 83% hit) — this makes the numbers match the demo.
- Quota must be checked **before enqueueing** the Claude run (phase-03 hook). Rejecting early protects the
  rate window and surfaces "quota rejects" like the demo. Cheap reject > burned quota.
- Cohorts from volume × behavior: `power / spam-prone / stuck / dormant / normal`. Auto-tighten cap when
  spam-prone. "Stuck" users get a `/help` nudge. These are scored on a schedule (cron-like interval).
- Everything writes `audit_log` → feeds dashboard Insights/Quota/Audit tabs (phase-07).

## Requirements
**Functional**
- **Notional cost meter**: from `quota_usage` token fields → `notional_cost_usd` using a rate table
  (input, output, cache_read, cache_write per-Mtok). Cache-aware. Store per message + roll up per user/day.
- **Quota gate**: `checkQuota(userId) → allow | deny(reason)` evaluated before run-queue enqueue.
  Deny → short polite Lark message + audit `quota_denied`, no Claude spawn.
- **Cohort classifier**: scheduled job scores users (volume, deny rate, repeat/stuck patterns) → set `cohort`, `risk_score`.
- **Auto-tighten**: when a user trips spam thresholds, reduce `quota_cap` and audit `quota_auto_tightened`.
- **Audit log**: typed events (`msg_in, run_started, run_done, reply_sent, quota_denied, quota_auto_tightened, cohort_changed`).

**Non-functional**
- Rate table in config (editable without code). Files < 200 lines. All money values are NOTIONAL — labeled as such in UI.

## Architecture
```
bridge/src/governance/
  cost-meter.ts          # tokens → notional_cost_usd (cache-aware rate table)
  rate-table.ts          # reference Sonnet rates (config-driven)
  quota-gate.ts          # checkQuota(userId) before enqueue
  quota-store.ts         # rollups: per-user/day usage + cap state
  cohort-classifier.ts   # scheduled scoring → cohort + risk_score
  auto-tighten.ts        # spam → reduce cap + audit
  audit-log.ts           # typed audit writer
  scheduler.ts           # setInterval cron for classifier + nudges
```
Flow: phase-03 run-queue calls `quota-gate.checkQuota` pre-enqueue; on run-done, `cost-meter` prices usage →
`quota-store` rollup; `scheduler` periodically runs `cohort-classifier` + `auto-tighten` + stuck-user nudge.

## Related Code Files
**Create**: all files under `bridge/src/governance/` above.
**Modify**: `bridge/src/engine/run-queue.ts` (call quota-gate before enqueue; call cost-meter after run),
`bridge/src/reply/send-reply.ts` (send polite deny message when quota-gate denies).
**Delete**: none.

## Implementation Steps
1. `rate-table.ts` + config: reference Sonnet per-Mtok rates for input/output/cache_read/cache_write.
2. `cost-meter.ts`: compute notional cost from the usage fields pinned in phase-03 step 1 (cache-aware). Unit-test against demo "20 msg ≈ $0.11–0.14, 83% cache".
3. `quota-store.ts`: per-user/day rollups + current cap; helpers to read remaining quota.
4. `quota-gate.ts`: `checkQuota` (cap vs used today); deny reason enum. Wire BEFORE run-queue enqueue.
5. `audit-log.ts`: typed writer; sprinkle calls across ingest/engine/reply.
6. `cohort-classifier.ts`: score `power/spam/stuck/dormant/normal` from volume + deny + repeat patterns.
7. `auto-tighten.ts`: spam threshold → lower cap + audit; expose for dashboard.
8. `scheduler.ts`: interval to run classifier + stuck-user `/help` nudge; configurable cadence.
9. Wire deny path → polite Lark reply via send-reply.

## Todo List
- [x] `rate-table.ts` + config (reference Sonnet rates, cache tiers)
- [x] `cost-meter.ts` (cache-aware) + test vs demo numbers
- [x] `quota-store.ts` (per-user/day rollups + cap)
- [x] `quota-gate.ts` pre-enqueue check + deny reasons
- [x] `audit-log.ts` typed writer wired across pipeline
- [x] `cohort-classifier.ts` (5 cohorts, risk_score)
- [x] `auto-tighten.ts` (spam → cap reduce + audit)
- [x] `scheduler.ts` (classifier + stuck nudge cadence)
- [x] Deny path → polite Lark message + audit

## Success Criteria
- Token usage → notional cost within ~range of demo (20 msgs ≈ $0.11–0.14 at 83% cache).
- A user over cap is denied BEFORE any Claude spawn; gets a polite message + `quota_denied` audit.
- Spam behavior triggers `quota_auto_tightened` (cap drops, audited).
- Scheduler assigns cohorts + risk scores; stuck users receive a `/help` nudge.
- Audit log captures the full lifecycle of every handled message.

## Risk Assessment
- **Wrong cache attribution** (Q2) → numbers diverge from demo; mitigate by pinning cache fields in phase-03 + the demo-number test.
- **Over-aggressive auto-tighten** locks out legit power users → conservative thresholds + manual override (dashboard).
- **Notional cost mistaken for real billing** → label "notional" everywhere in UI/logs.

## Security Considerations
- Quota enforced server-side in the daemon, never trusting client/dashboard input for caps without auth.
- Audit log is append-only; treat as PII (user ids + content refs) → local-only, access-controlled.

## Next Steps
Feeds phase-07 dashboard (Insights/Quota/Audit read these tables + live gauges).
