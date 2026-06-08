-- Lark Claude Bridge — SQLite schema
-- Single source of truth. Applied idempotently via user_version guard in migrate.ts.
-- NEVER drop columns or tables in MVP migrations; keep changes additive.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── projects ─────────────────────────────────────────────────────────────────
-- One row per Lark App. App = security boundary / tenant.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lark_app_id TEXT    NOT NULL UNIQUE,        -- e.g. cli_a9707ccfdea25ed1
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── agents ───────────────────────────────────────────────────────────────────
-- One row per AI role. folder_path points to an agent .md file directory.
CREATE TABLE IF NOT EXISTS agents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  folder_path TEXT    NOT NULL DEFAULT '',    -- path to agent instructions dir
  model       TEXT    NOT NULL DEFAULT 'sonnet',
  effort      TEXT,                           -- null = default; 'low'|'normal'|'high'
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);

-- ─── chat_bindings ────────────────────────────────────────────────────────────
-- Which agent answers in which Lark chat. Unique chat_id per project.
CREATE TABLE IF NOT EXISTS chat_bindings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_id    TEXT    NOT NULL,                -- Lark open_chat_id or user open_id
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  UNIQUE (project_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_bindings_project ON chat_bindings(project_id);

-- ─── sessions ─────────────────────────────────────────────────────────────────
-- chat_id is PK — one active Claude session per Lark chat.
CREATE TABLE IF NOT EXISTS sessions (
  chat_id           TEXT    PRIMARY KEY,      -- Lark open_chat_id / open_id
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id          INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  claude_session_id TEXT,                     -- resume token from Claude CLI
  last_active_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  message_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

-- ─── messages ─────────────────────────────────────────────────────────────────
-- UNIQUE(lark_message_id) = deduplication key for at-least-once delivery.
CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id          TEXT    NOT NULL,
  lark_message_id  TEXT    NOT NULL UNIQUE,   -- Lark event message_id — dedup key
  direction        TEXT    NOT NULL CHECK (direction IN ('inbound','outbound')),
  user_id          TEXT,                       -- Lark open_id of sender (null for bot)
  content          TEXT    NOT NULL DEFAULT '',
  claude_session_id TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- ─── users ────────────────────────────────────────────────────────────────────
-- Lark user profile cache + risk/quota settings.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lark_user_id  TEXT    NOT NULL,             -- Lark open_id
  display_name  TEXT    NOT NULL DEFAULT '',
  cohort        TEXT    NOT NULL DEFAULT 'default',
  risk_score    REAL    NOT NULL DEFAULT 0.0,
  quota_cap     INTEGER,                       -- max messages/day; null = unlimited
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, lark_user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id);

-- ─── quota_usage ──────────────────────────────────────────────────────────────
-- Per-message token accounting for cost tracking and rate-limiting.
CREATE TABLE IF NOT EXISTS quota_usage (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id          INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  notional_cost_usd   REAL    NOT NULL DEFAULT 0.0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quota_user ON quota_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_quota_message ON quota_usage(message_id);

-- ─── audit_log ────────────────────────────────────────────────────────────────
-- Immutable append-only event log for compliance and debugging.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_id      TEXT,
  user_id      TEXT,
  event_type   TEXT    NOT NULL,
  payload_json TEXT    NOT NULL DEFAULT '{}',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_event   ON audit_log(event_type);
