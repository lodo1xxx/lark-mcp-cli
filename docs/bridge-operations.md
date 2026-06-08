# Bridge Operations Runbook

Concise ops guide for the Lark Claude Bridge daemon + Next.js dashboard.

## Prerequisites

| Item | Check |
|------|-------|
| `lark-cli` installed | `lark-cli --version` |
| Lark app authed | `lark-cli auth login` (stores creds in lark-cli's own store) |
| `claude` CLI logged in via OAuth | `claude --version` + `~/.claude/.credentials.json` exists |
| Event subscription enabled | Lark Developer Console → app `cli_a9707ccfdea25ed1` → Events → `im.message.receive_v1` enabled |
| Node ≥ 20 | `node --version` |
| `bridge/config.json` present | Copy from `bridge/config.example.json`; set `lark_app_id`, `lark_cli_binary`, `bot_display_name` |
| DB migrated | `cd bridge && npm run migrate` |

No public webhook URL needed — bridge uses WebSocket long-connection via `lark-cli event consume`.

## Configure bridge/config.json

```json
{
  "lark_app_id": "cli_YOURAPPID",
  "lark_cli_binary": "/path/to/lark-cli",
  "bot_display_name": "YourBotName",
  "db_path": "./data/bridge.db",
  "engine_concurrency": 1,
  "queue_concurrency": 1,
  "port": 9820
}
```

Key fields:
- `bot_display_name` — must match the display name shown in Lark group @mentions.
- `engine_concurrency` / `queue_concurrency` — keep at 1 (serial) to protect the OAuth 5h rolling window. See Concurrency section below.
- `db_path` — relative to `bridge/`; default `./data/bridge.db`.

## Start / Stop

### Manual (dev / testing)

```bash
# Bridge daemon
cd bridge && npm run dev          # watch mode (auto-restart on file change)
cd bridge && npm run start        # production mode (used by pm2/launchd)

# Dashboard (separate terminal)
cd dashboard && npm run dev       # or: npm run build && npm start
```

### pm2 (recommended for production)

```bash
# First time
npm i -g pm2
pm2 start bridge/ops/ecosystem.config.cjs
pm2 save          # persist across reboots (then: pm2 startup)

# Daily ops
pm2 status
pm2 logs lark-bridge --lines 50
pm2 restart lark-bridge
pm2 stop lark-bridge
pm2 stop all
```

Logs land in `~/lark-bridge-logs/`.

### macOS launchd (fallback — bridge daemon only)

```bash
# Edit WorkingDirectory + PATH in the plist to match your machine
cp bridge/ops/com.transform.lark-bridge.plist ~/Library/LaunchAgents/
# Edit YOURUSERNAME placeholders in the plist
launchctl load ~/Library/LaunchAgents/com.transform.lark-bridge.plist

# Stop / uninstall
launchctl unload ~/Library/LaunchAgents/com.transform.lark-bridge.plist
```

Validate plist syntax: `plutil -lint ~/Library/LaunchAgents/com.transform.lark-bridge.plist`

Logs: `~/lark-bridge-logs/launchd-{out,err}.log`

## Backup / Restore

Both `bridge.db` (sessions, quota, messages) and `~/.claude` (OAuth + conversation sessions) must be backed up and restored together — desync causes chat memory loss.

### Backup

```bash
# Defaults: DB=bridge/data/bridge.db, dest=~/lark-bridge-backups, retain=7
bash bridge/scripts/backup.sh

# Custom
bash bridge/scripts/backup.sh --db /abs/path/bridge.db --dest /backups --retain 14
```

Script does: WAL checkpoint → copy db + sidecars → tar `~/.claude` → prune old snapshots → verify db.
Permissions: backup dir `700`, files `600`.
Schedule via cron: `0 3 * * * bash /path/to/bridge/scripts/backup.sh >> ~/lark-bridge-logs/backup.log 2>&1`

### Restore

```bash
SNAPSHOT=~/lark-bridge-backups/20260608-030000   # pick the snapshot dir

# 1. Stop daemon
pm2 stop lark-bridge
# or: launchctl unload ~/Library/LaunchAgents/com.transform.lark-bridge.plist

# 2. Restore db
cp "${SNAPSHOT}/bridge.db" bridge/data/bridge.db
# sidecar files if present:
cp "${SNAPSHOT}/bridge.db-wal" bridge/data/bridge.db-wal 2>/dev/null || true
cp "${SNAPSHOT}/bridge.db-shm" bridge/data/bridge.db-shm 2>/dev/null || true

# 3. Restore Claude sessions
tar -xzf "${SNAPSHOT}/claude-sessions.tar.gz" -C "${HOME}"

# 4. Restart
pm2 start lark-bridge
```

## Concurrency — OAuth Rate Window (Q6)

Claude CLI uses OAuth subscription (5-hour rolling window + weekly cap). Running too many parallel `claude -p` invocations trips the rate limit.

**Safe default: `engine_concurrency = 1` (serial).** One message processed at a time; next starts only after previous `claude -p` exits. This is the most conservative and has never been observed to trip the rate window in normal usage.

**Raising concurrency:**
1. Increase `engine_concurrency` in `config.json` (e.g. 2 or 3).
2. Watch logs for: `rate_limited`, `quota_denied`, `permission_denials > 0` in Claude envelopes.
3. If rate-limited: drop back to previous level; wait for the 5h window to reset.
4. Practical guideline: for a single-team group chat with typical usage, `concurrency=1` is sufficient. Only raise if you have multiple high-volume groups.

**Symptom of hitting the rate window:** Claude envelope returns `"is_error": true` with `permission_denials` array non-empty, or exit code non-zero with `429`/`rate` in stderr.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| WS not connecting | `lark-cli event consume` fails to start | Check `lark-cli auth login`, verify `lark_cli_binary` path in config |
| `stdin EOF kills consume` | Pipe closed prematurely | Bridge wraps consume with `< <(tail -f /dev/null)` — check `consume-process.ts` |
| `BAD_OUTPUT` from parser | Claude output not a JSON envelope | Ensure `claude` CLI version ≥ 2.1 supports `--output-format json` |
| OAuth rate window tripped | Too many concurrent `claude -p` | Drop `engine_concurrency` to 1; wait ~5h |
| `quota_denied` in audit log | Per-user daily/weekly cap hit | Adjust `rate_table` in config or user cohort; auto-tighten may have reduced cap |
| Dashboard shows stale data | Status writer stopped | Check `bridge/src/ops/status-writer.ts` heartbeat in logs |
| DB locked error | WAL conflict | Stop daemon before restore; never run two bridge daemons against same db |
| `session_id` not resuming | `~/.claude` sessions deleted or restored from wrong snapshot | Always restore db + sessions from the SAME snapshot |

## Dashboard

Runs on port 9820 (configurable via `port` in config.json or `PORT` env).
Access: `http://localhost:9820`

Pages: overview, messages, sessions, quota, agents, audit log.
Read-only view of SQLite. Never exposes `app_secret` or OAuth tokens.
