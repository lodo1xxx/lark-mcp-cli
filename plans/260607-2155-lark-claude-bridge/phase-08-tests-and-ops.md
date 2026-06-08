# Phase 08 — Tests + Ops (supervision, restart, backup, deploy)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-07](phase-07-web-dashboard.md)
- Grounding: analysis "Điều kiện vận hành" (WS long-conn local; no public URL; OAuth subscription)

## Overview
- **Priority**: P2
- **Status**: complete (2026-06-08)
- **Effort**: 1d
- Test coverage for the pure-logic units, an end-to-end smoke, process supervision/restart for both child
  processes (event consume + claude runs) and the daemon, backup of `~/.claude` sessions + `bridge.db`,
  and deployment/run notes for macOS local operation.

## Key Insights
- Subprocess-heavy design → **unit-test pure logic** (ndjson-reader, event-filter, chunker, cost-meter,
  cohort-classifier, output-parser) against fixtures; **smoke-test** the live path sparingly to avoid burning
  OAuth quota. Mock claude/lark-cli at the subprocess boundary for unit tests; use 1-2 real runs for smoke only.
- Memory durability depends on `~/.claude` session files + `sessions` table → both must be backed up together,
  or a restore desyncs chat_id ↔ session_id. Back them up as a pair.
- Local-only operation (WS long-conn, no public URL). Supervision = restart event-consume child on drop;
  restart daemon via launchd/pm2; cap concurrency to respect the 5h OAuth window (soak to find safe number → Q6).

## Requirements
**Functional**
- Unit tests for pure modules with fixtures (incl. the sampled Lark payload + sampled Claude JSON).
- One gated E2E smoke: real @mention → reply (manual/CI-optional, quota-aware).
- Supervision: event-consume auto-restart (already in phase-02) + daemon-level supervisor (pm2/launchd) docs.
- Backup script: snapshot `bridge.db` (WAL checkpoint) + `~/.claude` sessions, timestamped, retain N.
- Deploy/run docs: env setup, enable Lark event, start daemon + dashboard, restore procedure.

**Non-functional**
- Tests deterministic (no live network in unit layer). Files < 200 lines.

## Architecture
```
bridge/
  test/
    fixtures/            # sampled lark event json, sampled claude json
    ndjson-reader.test.ts
    event-filter.test.ts
    chunker.test.ts
    output-parser.test.ts
    cost-meter.test.ts
    cohort-classifier.test.ts
    e2e-smoke.test.ts    # gated (BRIDGE_E2E=1), real subprocess
  scripts/
    backup.sh            # checkpoint db + tar ~/.claude sessions
    supervisor notes     # pm2 ecosystem / launchd plist (docs)
docs/
  bridge-operations.md   # run/restore/troubleshoot
```

## Related Code Files
**Create**: `bridge/test/**`, `bridge/scripts/backup.sh`, `docs/bridge-operations.md`,
pm2 ecosystem file or launchd plist (under `bridge/ops/`).
**Modify**: `bridge/package.json` (test scripts), root docs index if present.
**Delete**: none.

## Implementation Steps
1. Add test runner (node:test or vitest) + scripts. Wire fixtures from phase-02/phase-03 samples.
2. Unit tests: ndjson-reader (partial lines), event-filter (mention/group matrix), chunker (code-fence-safe),
   output-parser (claude json), cost-meter (demo numbers), cohort-classifier (cohort boundaries).
3. Gated E2E smoke: behind `BRIDGE_E2E=1`; one real @mention → reply assertion; skip in normal CI.
4. `backup.sh`: `PRAGMA wal_checkpoint(TRUNCATE)` + copy `bridge.db` + tar `~/.claude` sessions, timestamped, retain last N.
5. Supervisor: pm2 ecosystem (or launchd plist) for daemon + dashboard; restart-on-crash, log rotation.
6. `docs/bridge-operations.md`: prerequisites (enable Lark event, claude logged in), start/stop, backup/restore, troubleshooting.
7. **Soak test (Q6)**: run for a period at concurrency=1, raise gradually, record when OAuth rate window trips; document safe `engineConcurrency`.

## Todo List
- [x] Test runner + scripts + fixtures wired (fixtures in bridge/test/fixtures/)
- [x] Unit tests: ndjson (8 new tests), filter, chunker, output-parser, cost-meter, cohort-classifier (all covered via governance.test.ts)
- [x] Gated E2E smoke (`BRIDGE_E2E=1`) — bridge/test/e2e-smoke.test.ts; skipped in normal npm test
- [x] `backup.sh` (db checkpoint + ~/.claude tar, retention) — bridge/scripts/backup.sh
- [x] Supervisor config (pm2/launchd) — bridge/ops/ecosystem.config.cjs + com.transform.lark-bridge.plist
- [x] `docs/bridge-operations.md` (run/restore/troubleshoot/concurrency)
- [x] Soak test → documented safe engineConcurrency=1 serial (Q6 resolved); see bridge-operations.md

## Success Criteria
- `npm test` passes all unit tests deterministically (no live calls).
- Gated E2E smoke succeeds against real @mention when enabled.
- Killing the daemon → supervisor restarts it; event stream resumes; sessions intact.
- Backup → restore reproduces working chat memory (db + ~/.claude in sync).
- Documented safe concurrency that does not trip the OAuth rate window in soak.

## Risk Assessment
- **E2E burns OAuth quota** → gate behind env flag; keep to 1-2 runs.
- **Backup desync** (db vs ~/.claude) → always snapshot both atomically in one script run.
- **Concurrency too high trips rate window** → soak-derived cap + backoff (phase-03).
- **macOS launchd quirks** → provide pm2 fallback.

## Security Considerations
- Backups contain PII (messages) + OAuth session material (`~/.claude`) → encrypt/permission-restrict backups, local-only.
- Never commit fixtures containing real user content/tokens — scrub sample payloads.

## Next Steps
Project operational. Revisit multi-app routing (Q4) and transcript-fallback memory (Q3) if scaling beyond 1 app.
