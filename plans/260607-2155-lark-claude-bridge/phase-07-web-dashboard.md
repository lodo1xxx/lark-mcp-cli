# Phase 07 — Web Dashboard (Next.js :9820, QR add-platform)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-06](phase-06-governance-quota-cost.md)
- Repo evidence: `cmd/auth/qrcode.go`, `auth login --no-wait/--device-code`, `sidecar/.../auth_bridge.go`
- Grounding: analysis "Dashboard @ :9820", Insights/Quota/Dashboard screenshots

## Overview
- **Priority**: P2
- **Status**: complete
- **Effort**: 1.5d
- Next.js dashboard on :9820 reading the bridge SQLite: Dashboard (live activity + in-flight),
  Projects (apps/agents/bindings), Insights (cohorts/risk), Quota (caps/usage/denies), Audit (event log),
  plus a QR "add platform" self-service flow over `lark-cli auth login` device-code.

## Key Insights
- Dashboard is **read-mostly** over the same SQLite the daemon writes (WAL → safe concurrent reads). Writes
  limited to admin actions (rebind agent, set cap, toggle skill) via a thin API that calls into bridge stores.
- QR add-platform reuses `lark-cli auth login --device-code/--no-wait` (device flow) — wrap login/poll/status,
  do NOT build new OAuth. app_secret stays on the daemon host; dashboard never sees it.
- "Live activity" = poll engine gauges (`inFlight`, `queued`) + recent `audit_log` (simple polling, no WS needed for MVP).
- All money labeled **notional**. KISS: server components reading SQLite directly; minimal client JS.

## Requirements
**Functional**
- Pages: `/` Dashboard, `/projects`, `/insights`, `/quota`, `/audit`, `/add-platform` (QR).
- Dashboard: messages/min, in-flight + queued runs, notional spend today, quota-deny count, top spenders.
- Projects: list apps → agents → chat bindings; rebind chat→agent; toggle agent/skill enabled.
- Insights: cohort distribution, risk scores, stuck users, highest spenders today.
- Quota: per-user cap vs used, manual cap override, auto-tighten history.
- Audit: paginated event log with filters (chat/user/type).
- Add-platform: render QR / device code from `lark-cli auth login`, poll status, show success.

**Non-functional**
- Runs on :9820 (config). Files < 200 lines. No app_secret in client bundle or network responses.

## Architecture
```
dashboard/                      # Next.js (app router)
  app/
    page.tsx                    # Dashboard
    projects/page.tsx
    insights/page.tsx
    quota/page.tsx
    audit/page.tsx
    add-platform/page.tsx
    api/
      gauges/route.ts           # read engine in-flight/queued (daemon endpoint or shared file)
      bindings/route.ts         # rebind chat→agent
      quota/route.ts            # set cap / read usage
      auth-qr/route.ts          # proxy lark-cli auth login device flow
  lib/
    db.ts                       # read-only better-sqlite3 over bridge.db
    queries.ts                  # named read queries (cohorts, spend, audit)
```
Bridge daemon exposes a tiny localhost control endpoint (or shared status file) for live gauges + admin writes;
dashboard API routes call it. Reads hit SQLite directly.

## Related Code Files
**Create**: `dashboard/` Next.js app + pages + api routes + `lib/db.ts` + `lib/queries.ts`.
**Modify**: `bridge/src/index.ts` (expose minimal localhost control endpoint for gauges + admin writes);
`bridge/src/engine/run-queue.ts` (export gauge snapshot).
**Delete**: none.

## Implementation Steps
1. Scaffold Next.js in `dashboard/` (app router, TS). Configure port 9820.
2. `lib/db.ts` + `queries.ts`: read-only SQLite queries for each page.
3. Build read pages (Dashboard, Insights, Quota, Audit, Projects) as server components.
4. Bridge: add minimal localhost control endpoint (gauges + admin actions); secure to localhost only.
5. Admin API routes: bindings rebind, quota cap override, skill/agent toggle → call bridge endpoint.
6. Add-platform: `api/auth-qr` wraps `lark-cli auth login --device-code/--no-wait`; page renders QR/code + polls status.
7. Live activity polling (gauges + recent audit) on Dashboard.

## Todo List
- [x] Scaffold Next.js on :9820
- [x] `lib/db.ts` + `queries.ts` (read-only)
- [x] Dashboard page (live gauges + spend + denies)
- [x] Projects page (apps/agents/bindings + rebind/toggle)
- [x] Insights page (cohorts/risk/spenders)
- [x] Quota page (caps/usage/override/auto-tighten history)
- [x] Audit page (filterable, paginated)
- [x] Bridge status-file writer (status.json, no HTTP port — KISS deviation)
- [x] Add-platform QR flow over `lark-cli auth login`

## Success Criteria
- All six pages render live data from `bridge.db`.
- Rebinding a chat→agent in Projects takes effect on the next message.
- Setting a quota cap in Quota is enforced by the daemon's quota-gate.
- Add-platform QR completes a device-flow login without exposing app_secret.
- Dashboard shows in-flight/queued runs updating during activity.

## Risk Assessment
- **SQLite read/write contention** → WAL + read-only dashboard connection; writes go through daemon endpoint.
- **Admin endpoint exposure** → bind localhost only; add a simple shared-secret/token if ever remote.
- **QR device-flow UX** → poll with clear timeout/expiry states.

## Security Considerations
- app_secret NEVER in client bundle or API responses; auth flow brokered by daemon/lark-cli only.
- Admin write endpoints require auth (at minimum localhost-only + token); validate all inputs.
- Treat dashboard data (messages, users) as PII; no external analytics.

## Next Steps
Operational hardening + tests in phase-08.
