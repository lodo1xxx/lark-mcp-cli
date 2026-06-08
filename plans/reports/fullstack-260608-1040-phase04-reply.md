# Phase 04 — Reply Path Implementation Report

**Date**: 2026-06-08  
**Phase**: phase-04-reply-path  
**Status**: completed

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `bridge/src/reply/reply-types.ts` | 30 | ReplyRequest, ReplyResult, ReplyError types |
| `bridge/src/reply/markdown-to-lark.ts` | 15 | Minimal GFM normalization (trim + empty guard) |
| `bridge/src/reply/chunker.ts` | 62 | Size-capped split; fence-aware; (i/n) prefixes |
| `bridge/src/reply/send-reply.ts` | 215 | Spawn lark-cli; retry; fallback; persist |
| `bridge/test/chunker.test.ts` | 96 | 9 chunker tests |
| `bridge/test/send-reply.test.ts` | 190 | 9 send-reply tests (dry-run only) |

## Files Modified

| File | Change |
|------|--------|
| `bridge/src/config/load-config.ts` | Added `reply_max_chars` field (default 3000) |
| `bridge/src/ingest/router.ts` | Added ReplyConfig; wired engine→reply in EngineQueue.push; empty-prompt → help line (skips engine) |
| `bridge/src/index.ts` | Passes engineCfg + replyCfg to routeMessage |

## Acceptance Criteria

1. **`npx tsc --noEmit` passes** — clean (0 errors)
2. **`npm test` all green** — 75/75 (58 existing + 17 new); no regressions
3. **Chunker tests**:
   - short → 1 chunk no prefix ✅
   - long → N ordered chunks with (i/n) ✅
   - fenced code block NOT split mid-fence ✅ (fence-aware flush logic: tracks inFence before+after toggle, blocks flush on fence-open AND fence-close lines)
4. **send-reply tests (dry-run)**:
   - Correct argv shape confirmed via lark-cli --dry-run output (verified manually) ✅
   - Sequential order preserved ✅
   - Retry on bad binary → fallback → audit_log reply_failed ✅
   - Outbound messages + audit_log rows persisted ✅
   - No real message sent in unit tests (dryRun:true) ✅
5. **Real smoke send**: `lark-cli im +messages-send --as bot --chat-id oc_2d1920f8015432088e8013a9a46a17fa --text "✅ Bridge phase-04 smoke test" --json`
   - **Delivered** — message_id: `om_x100b6d505ec49ca4e156e8c8447bbc8`
6. **Empty-prompt path**: empty text → markdownToLark returns placeholder → sendReply sends 1 chunk (help); engine not called ✅ (empty text check in EngineQueue.push before runEngineJob)

## Key Decisions

- **lark-cli dry-run stdout format**: `=== Dry Run ===\n{JSON}` — strip non-JSON prefix before `JSON.parse` in spawnSend.
- **dry-run message_id fallback**: returns `"dry-run"` string; use `idem:<idempotencyKey>` as stored lark_message_id to avoid INSERT OR IGNORE collision on the UNIQUE constraint.
- **Chunker fence fix**: track `wasInFence` (before toggle) and block flush when: (a) inside fence, or (b) current line is closing a fence (to keep close marker with its block).
- **YAGNI**: markdown-to-lark.ts is intentionally minimal — `--markdown` flag in lark-cli handles GFM→Lark rendering.

## Live Daemon Launch

```bash
cd /Users/lodo/Documents/vibe/LarkCLI/lark-mcp-cli/bridge
npm run dev
# or: node --import tsx/esm src/index.ts
```

Requires `config.json` at bridge root with `lark_app_id`, `lark_cli_binary`, `engine_claude_binary`. After boot, any @mention of the bot in the test group (`oc_2d1920f8015432088e8013a9a46a17fa`) triggers the full pipeline: ingest → engine → reply.

## Deviations from Spec

- `markdown-to-lark.ts` is purely a trim+empty-guard (no GFM transforms). The `--markdown` flag in lark-cli handles all rendering — per spec guidance (YAGNI).
- `storedId` substitution for dry-run/unknown message IDs: not in original spec but necessary for test DB uniqueness.

## Unresolved Questions

None.
