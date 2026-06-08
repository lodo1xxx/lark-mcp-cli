# Phase 01 — Project Scaffold + SQLite Schema + Config

## Context Links
- Overview: [plan.md](plan.md)
- Grounding: `../reports/analysis-260607-1706-claude-bridge-reverse-engineering.md`
- Multi-tenant reference: `sidecar/server-multi-tenant-demo/README.md`

## Overview
- **Priority**: P1 (foundation — everything depends on it)
- **Status**: complete
- **Effort**: 1d
- Scaffold a single Node/TS package (`bridge/`) + a separate Next.js app (`dashboard/`) under repo.
  Define the SQLite schema (projects/agents/sessions/messages/quota/audit), config loader, and migrations.

## Key Insights
- Single package, not a heavy monorepo — KISS. Two top dirs: `bridge/` (daemon) and `dashboard/` (Next.js),
  sharing one SQLite file. No shared TS package needed for MVP; duplicate the ~30-line DB types if simpler.
- Data model must be multi-tenant from day 1 even though we run 1 app: App = security boundary,
  Agent = role boundary. This is a schema decision, cheap now, expensive to retrofit.
- Use `better-sqlite3` (sync, simple, fast, WAL) — avoids async ceremony for a single-host daemon.

## Requirements
**Functional**
- One SQLite DB file at `bridge/data/bridge.db` (WAL mode).
- Tables: `projects`, `agents`, `chat_bindings`, `sessions`, `messages`, `quota_usage`, `users`, `audit_log`.
- Config from `bridge/config.json` + env overrides; NO secrets in repo.
- Idempotent migration runner (run on daemon boot).

**Non-functional**
- All source files < 200 lines, kebab-case.
- Secrets (Lark app_secret) only via env / lark-cli's own config — never stored in bridge DB or config.json.

## Architecture
```
bridge/
  src/
    db/
      schema.sql            # DDL, single source of truth
      migrate.ts            # idempotent runner (CREATE IF NOT EXISTS + user_version)
      client.ts             # better-sqlite3 singleton, WAL pragma
      types.ts              # row interfaces
    config/
      load-config.ts        # config.json + env merge, zod validate
    index.ts                # (stub, filled phase-02)
  config.example.json
  package.json
data/bridge.db              # gitignored
dashboard/                  # (scaffold only; built phase-07)
```

### Schema (DDL outline)
- `projects(id, lark_app_id, name, created_at, status)` — App = tenant/security boundary.
- `agents(id, project_id, name, folder_path, model, effort, enabled, created_at)` — role boundary; folder_path → `.md` agent dir.
- `chat_bindings(id, project_id, chat_id, agent_id, enabled)` — which agent answers in which chat (unique chat_id per project).
- `sessions(chat_id PK, project_id, agent_id, claude_session_id, last_active_at, message_count)` — chat_id ↔ Claude session.
- `messages(id, chat_id, lark_message_id UNIQUE, direction, user_id, content, claude_session_id, created_at)` — UNIQUE(lark_message_id) = dedup key.
- `users(id, project_id, lark_user_id, display_name, cohort, risk_score, quota_cap, created_at)`.
- `quota_usage(id, user_id, message_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, notional_cost_usd, created_at)`.
- `audit_log(id, project_id, chat_id, user_id, event_type, payload_json, created_at)`.

## Related Code Files
**Create**: `bridge/package.json`, `bridge/tsconfig.json`, `bridge/config.example.json`, `bridge/.gitignore`,
`bridge/src/db/schema.sql`, `bridge/src/db/migrate.ts`, `bridge/src/db/client.ts`, `bridge/src/db/types.ts`,
`bridge/src/config/load-config.ts`, `bridge/src/index.ts` (stub).
**Modify**: root `.gitignore` (add `bridge/data/`, `bridge/node_modules`, `dashboard/.next`).
**Delete**: none.

## Implementation Steps
1. `npm init` in `bridge/`; add deps: `better-sqlite3`, `zod`, `tsx`/`typescript`. Add scripts: `dev`, `build`, `migrate`.
2. Write `schema.sql` with all 8 tables + indexes (`idx_messages_chat`, `idx_quota_user`, unique on `lark_message_id`).
3. `client.ts`: open DB, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`; export singleton.
4. `migrate.ts`: read `user_version`, apply schema if 0, bump version. Idempotent on every boot.
5. `load-config.ts`: load `config.json`, overlay env (`BRIDGE_PORT`, `LARK_APP_ID`, paths), zod-validate, export typed config.
6. Seed one `project` row (app `cli_a9707ccfdea25ed1`) + one default `agent` via a `seed` script.
7. `config.example.json`: app_id, port 9820, claude binary path, lark-cli path, default model, queue size. No secrets.

## Todo List
- [x] Init `bridge/` package + tsconfig + scripts
- [x] Write `schema.sql` (8 tables + indexes + unique lark_message_id)
- [x] `client.ts` (WAL + FK pragmas, singleton)
- [x] `migrate.ts` (idempotent, user_version)
- [x] `types.ts` row interfaces
- [x] `load-config.ts` (zod, env overlay, no secrets)
- [x] `seed` script (1 project + 1 default agent)
- [x] `config.example.json` + update root `.gitignore`
- [x] `npm run migrate` creates DB cleanly; `npm run seed` populates

## Success Criteria
- `npm run migrate` then `npm run seed` produces `bridge.db` with all tables and 1 project + 1 agent.
- Re-running migrate is a no-op (no errors, no dupes).
- No secret values present anywhere in `bridge/` tracked files.

## Risk Assessment
- **better-sqlite3 native build** on Node 24 — mitigate: verify install early; fallback `node:sqlite` (built-in, experimental) if native build fails.
- **Schema churn** later — mitigate: keep migrations additive; never DROP in MVP.

## Security Considerations
- app_secret stays in lark-cli's own auth store / env, never in bridge DB or `config.json`.
- `bridge/data/` gitignored; DB may contain message content + user ids (PII) → local-only file perms.

## Next Steps
Unblocks phase-02 (consumes config + writes `messages`/`sessions`) and phase-03 (writes `quota_usage`).
