# Phase 07 — Web Dashboard: Completion Report

## Status: COMPLETE

Build: `npm run build` — PASS (no TS errors, all 9 routes compiled)
All 6 pages: HTTP 200 confirmed via curl against `next start -p 9820`
Bridge unit tests: 77/77 PASS (0 failures)

---

## Files Modified / Created

### Bridge (modifications)
- `bridge/src/engine/index.ts` — added `getGauges()` export (inFlight/queued snapshot from singleton RunQueue)
- `bridge/src/index.ts` — import + start `startStatusWriter(getGauges)` on boot; `markEvent()` on each accepted event; `stopStatusWriter()` on SIGINT/SIGTERM
- `bridge/src/ops/status-writer.ts` — NEW: writes `bridge/data/status.json` every 3s via `setInterval().unref()`. Exports `startStatusWriter`, `stopStatusWriter`, `markEvent`

### Dashboard (all new — `dashboard/`)
**Lib**
- `lib/db.ts` — read-only better-sqlite3 singleton; resolves path via `BRIDGE_DB_PATH` env (default `../bridge/data/bridge.db`)
- `lib/admin-db.ts` — read-write singleton for admin API routes
- `lib/queries.ts` — all named read queries (dashboard stats, top spenders, projects+agents+bindings, cohorts, risk, stuck sessions, cache stats, quota rows, auto-tighten history, paginated audit)
- `lib/status.ts` — reads `bridge/data/status.json`; staleness check (>15s → offline)

**Components**
- `components/sidebar-nav.tsx` — client nav with active-link highlighting
- `components/live-gauges.tsx` — client island polling `/api/gauges` every 5s
- `components/project-actions.tsx` — client island: toggle-agent + rebind-chat actions
- `components/quota-cap-form.tsx` — client island: inline quota cap override

**Pages (server components)**
- `app/page.tsx` — Dashboard: status pill, 4 stat cards, LiveGauges island, top spenders table
- `app/projects/page.tsx` — Projects: project→agent→binding tree; ProjectActions islands
- `app/insights/page.tsx` — Insights: cohort counts, cache efficiency, high-risk users, stuck sessions, top spenders
- `app/quota/page.tsx` — Quota: per-user cap vs used, QuotaCapForm island, auto-tighten history
- `app/audit/page.tsx` — Audit: paginated table with chatId/userId/eventType filters + pagination links
- `app/add-platform/page.tsx` — Add Platform: shell for AddPlatformFlow client island
- `components/add-platform-flow.tsx` — full device-code UX: POST /api/auth-qr → QR render (qrcode lib) + poll loop

**API Routes**
- `app/api/gauges/route.ts` — GET: reads status.json, returns inFlight/queued/online/uptimeMs
- `app/api/bindings/route.ts` — POST (rebind), PATCH (toggle enabled); zod-validated
- `app/api/quota/route.ts` — PATCH (set quota_cap); zod-validated
- `app/api/agents/route.ts` — PATCH (toggle enabled); zod-validated
- `app/api/auth-qr/route.ts` — POST (start device flow via `lark-cli auth login --no-wait --json`), GET (poll with `--device-code`)

**Config**
- `next.config.ts` — `serverExternalPackages: ["better-sqlite3"]`
- `app/layout.tsx` — root layout with SidebarNav

---

## Acceptance Checks

1. **`npm run build` passes** — YES. Zero TS errors, all 9 routes (6 pages + 4 API + /_not-found) compiled.

2. **All 6 pages HTTP 200** — YES.
   ```
   / → 200, /projects → 200, /insights → 200
   /quota → 200, /audit → 200, /add-platform → 200
   GET /api/gauges → {"inFlight":0,"queued":0,"online":true,...}
   ```

3. **db.ts reads real bridge.db** — YES. Read-only connection against `bridge/data/bridge.db` (WAL). Queries return real rows (seed project + Default Agent confirmed via admin write test).

4. **status.json** — Bridge writes file every 3s from `getGauges()`. Dashboard reads it with 15s staleness threshold. Test: wrote fake status.json → `/api/gauges` returned `online: true` with correct fields. `stopStatusWriter()` clears interval on shutdown.

5. **Admin write path** — Verified via tsx script against temp DB copy. `INSERT INTO chat_bindings … ON CONFLICT … DO UPDATE` mirrors binding-store.ts exactly. Daemon re-reads chat_bindings per message (resolve-agent queries on each event) → changes take effect with next message, no restart needed.

6. **QR route** — `lark-cli auth login --help` confirms `--no-wait --json` and `--device-code` flags. `app/api/auth-qr/route.ts` shells to `lark-cli` server-side only; token/secret never forwarded to client (only `status` field returned on poll). `add-platform-flow.tsx` generates QR via `qrcode` lib (dynamic import), shows URL as text fallback. Full state machine: idle → loading → pending → complete/expired/error with cancel option.

---

## Architecture Deviation: Status File vs HTTP Control Endpoint

Spec proposed bridge HTTP control endpoint. Implemented status-file approach instead per instructions:
- `bridge/src/ops/status-writer.ts` writes `bridge/data/status.json` every 3s
- Dashboard reads file directly — no cross-process HTTP, no CORS, no port conflict
- Admin writes go direct to bridge.db from Next.js API routes (read-write connection)
- Daemon re-reads DB per message — changes apply on next event without restart

---

## How to Launch

```bash
# 1. Start the bridge daemon (writes status.json every 3s)
cd bridge && npm run dev

# 2. Start dashboard (separate terminal)
cd dashboard && npm run dev -- -p 9820
# OR: npm run build && npm run start -- -p 9820

# 3. Open http://localhost:9820
```

Environment variables (optional):
- `BRIDGE_DB_PATH` — override path to bridge.db (default: `../bridge/data/bridge.db`)
- `BRIDGE_STATUS_PATH` — override path to status.json (default: `../bridge/data/status.json`)
- `LARK_CLI_BINARY` — override lark-cli path (default: `lark-cli`)

---

## Bridge Tests
- Unit tests (77): ALL PASS
- Engine-integration tests: pre-existing timeout failures (require live Claude binary — not a regression)
