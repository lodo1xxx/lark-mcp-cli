#!/usr/bin/env bash
# backup.sh — Atomic snapshot: bridge.db (WAL checkpoint) + ~/.claude sessions.
# Both are snapshotted in ONE run so chat_id↔session_id stay in sync.
#
# Usage: bash backup.sh [--db PATH] [--dest DIR] [--retain N]
#   --db      path to bridge.db (default: ../data/bridge.db relative to this script)
#   --dest    backup root dir   (default: ~/lark-bridge-backups)
#   --retain  how many to keep  (default: 7)
#
# Security: backups contain PII + OAuth sessions. chmod 600/700 enforced.
# NEVER commit backups to git. Add the dest dir to .gitignore.

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DB_PATH="${BRIDGE_DB_PATH:-${BRIDGE_ROOT}/data/bridge.db}"
DEST_ROOT="${BRIDGE_BACKUP_DIR:-${HOME}/lark-bridge-backups}"
RETAIN="${BRIDGE_BACKUP_RETAIN:-7}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SNAPSHOT_DIR="${DEST_ROOT}/${TIMESTAMP}"
CLAUDE_DIR="${HOME}/.claude"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)    DB_PATH="$2";    shift 2 ;;
    --dest)  DEST_ROOT="$2";  SNAPSHOT_DIR="${DEST_ROOT}/${TIMESTAMP}"; shift 2 ;;
    --retain) RETAIN="$2";    shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ ! -f "${DB_PATH}" ]]; then
  echo "ERROR: bridge.db not found at ${DB_PATH}" >&2
  echo "  Set --db PATH or BRIDGE_DB_PATH env var." >&2
  exit 1
fi

if [[ ! -d "${CLAUDE_DIR}" ]]; then
  echo "WARNING: ~/.claude not found at ${CLAUDE_DIR} — skipping Claude session backup." >&2
fi

# ── Create snapshot dir with restrictive perms ─────────────────────────────
mkdir -p "${DEST_ROOT}"
chmod 700 "${DEST_ROOT}"
mkdir -p "${SNAPSHOT_DIR}"
chmod 700 "${SNAPSHOT_DIR}"

echo "=== Lark Bridge Backup ==="
echo "Timestamp : ${TIMESTAMP}"
echo "DB source : ${DB_PATH}"
echo "Dest      : ${SNAPSHOT_DIR}"
echo ""

# ── Step 1: WAL checkpoint (flush WAL → main db file) ─────────────────────
echo "[1/3] WAL checkpoint..."
if command -v sqlite3 &>/dev/null; then
  sqlite3 "${DB_PATH}" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
else
  # Fallback: use node + better-sqlite3 (available in bridge)
  node --input-type=module <<EOF 2>/dev/null || true
import Database from 'better-sqlite3';
const db = new Database('${DB_PATH}');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.error('WAL checkpoint via better-sqlite3 done.');
EOF
fi
echo "    done."

# ── Step 2: Copy bridge.db + WAL/SHM sidecar files ────────────────────────
echo "[2/3] Copying bridge.db..."
cp "${DB_PATH}" "${SNAPSHOT_DIR}/bridge.db"
chmod 600 "${SNAPSHOT_DIR}/bridge.db"

for ext in "-wal" "-shm"; do
  if [[ -f "${DB_PATH}${ext}" ]]; then
    cp "${DB_PATH}${ext}" "${SNAPSHOT_DIR}/bridge.db${ext}"
    chmod 600 "${SNAPSHOT_DIR}/bridge.db${ext}"
    echo "    copied sidecar: bridge.db${ext}"
  fi
done
echo "    done."

# ── Step 3: Tar ~/.claude sessions ────────────────────────────────────────
CLAUDE_TAR="${SNAPSHOT_DIR}/claude-sessions.tar.gz"
echo "[3/3] Archiving ~/.claude sessions..."
if [[ -d "${CLAUDE_DIR}" ]]; then
  # Exclude large caches and socket files; keep credentials + session JSON
  tar -czf "${CLAUDE_TAR}" \
    --exclude="*.sock" \
    --exclude="__pycache__" \
    --exclude="node_modules" \
    -C "${HOME}" \
    ".claude" 2>/dev/null || true
  chmod 600 "${CLAUDE_TAR}"
  TAR_SIZE="$(du -sh "${CLAUDE_TAR}" | cut -f1)"
  echo "    done (${TAR_SIZE})."
else
  echo "    WARNING: ~/.claude missing — skipping."
fi

# ── Retention: prune old snapshots keeping newest N ───────────────────────
echo ""
echo "Pruning to newest ${RETAIN} snapshots..."
# List dirs sorted oldest-first, delete all beyond newest N
SNAPSHOT_COUNT="$(find "${DEST_ROOT}" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
if (( SNAPSHOT_COUNT > RETAIN )); then
  TO_DELETE=$(( SNAPSHOT_COUNT - RETAIN ))
  find "${DEST_ROOT}" -maxdepth 1 -mindepth 1 -type d \
    | sort \
    | head -n "${TO_DELETE}" \
    | while read -r OLD; do
        echo "  removing ${OLD}"
        rm -rf "${OLD}"
      done
fi
REMAINING="$(find "${DEST_ROOT}" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
echo "  ${REMAINING} snapshot(s) retained."

# ── Verify db copy is readable ────────────────────────────────────────────
echo ""
echo "Verifying backup db..."
if command -v sqlite3 &>/dev/null; then
  TABLES="$(sqlite3 "${SNAPSHOT_DIR}/bridge.db" ".tables" 2>/dev/null | tr -s ' \t\n' ' ')"
  if [[ -n "${TABLES}" ]]; then
    echo "  OK — tables: ${TABLES}"
  else
    echo "  WARNING: db opened but no tables found."
  fi
else
  echo "  (sqlite3 CLI not available — skipping table check)"
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Backup complete: ${SNAPSHOT_DIR} ==="
echo ""
echo "Restore instructions:"
echo "  1. Stop daemon:     pm2 stop lark-bridge  (or: launchctl unload ~/Library/LaunchAgents/com.transform.lark-bridge.plist)"
echo "  2. Restore db:      cp ${SNAPSHOT_DIR}/bridge.db ${DB_PATH}"
echo "  3. Restore sessions: tar -xzf ${SNAPSHOT_DIR}/claude-sessions.tar.gz -C ${HOME}"
echo "  4. Start daemon:    pm2 start lark-bridge  (or reload launchd plist)"
echo "  NOTE: Always restore BOTH db + sessions together — they must stay in sync."
