# Phase 05 — Multi-Agent System: Completion Report

**Date:** 2026-06-08  
**Status:** COMPLETE  
**Tests:** 95 pass / 0 fail (was 75, added 20 new)

---

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `bridge/agents/default/CLAUDE.md` | 17 | Default agent system prompt (Vietnamese) |
| `bridge/agents/default/agent.json` | 10 | Manifest: read-only tools subset |
| `bridge/agents/sales/CLAUDE.md` | 18 | Sales assistant persona (Vietnamese) |
| `bridge/agents/sales/agent.json` | 9 | Manifest: CRM/contact/doc tools |
| `bridge/agents/README.md` | 56 | Agent folder contract documentation |
| `bridge/src/agents/agent-manifest.ts` | 79 | Zod-validate agent.json, resolve paths → typed Agent |
| `bridge/src/agents/mcp-allowlist.ts` | 61 | Write per-agent --mcp-config JSON, compute prefixed tool names |
| `bridge/src/agents/agent-registry.ts` | 115 | Scan agents/, upsert DB, in-memory map, fs.watch + debounce |
| `bridge/src/agents/binding-store.ts` | 71 | chat_bindings CRUD (get/set/disable/list) |
| `bridge/src/agents/resolve-agent.ts` | 48 | chatId → RegisteredAgent (binding | default fallback) |
| `bridge/test/agents.test.ts` | 400 | Unit tests: all 5 new modules |

## Files Modified

| File | Change |
|------|--------|
| `bridge/src/engine/engine-types.ts` | Added `allowedTools?: string[]` to RunRequest |
| `bridge/src/engine/claude-runner.ts` | buildArgv: added --mcp-config, --strict-mcp-config, --allowedTools, --permission-mode acceptEdits |
| `bridge/src/engine/index.ts` | Calls resolveAgent(db, chatId) → populates cwd/model/mcpConfigPath/allowedTools |
| `bridge/src/index.ts` | Calls reloadAgents(db) + startWatcher(db) at startup; stopWatcher() on shutdown |

---

## Acceptance Results

| # | Acceptance Item | Result |
|---|----------------|--------|
| 1 | `npx tsc --noEmit` passes | PASS |
| 1 | `npm test` all green | PASS — 95/95 |
| 2 | agent-manifest + registry unit tests: loads default + sales; upserts agents table; invalid manifest rejected | PASS — 10 tests |
| 3 | mcp-allowlist unit test: valid --mcp-config file + correct `mcp__lark-cli__*` names | PASS |
| 4 | resolve-agent unit test: bound chat → its agent; unbound → default | PASS — 4 tests |
| 5 | binding-store unit test: set/get/disable/list | PASS — 5 tests |
| 6 | E2E tool-use smoke (allowed tool) | PASS — `lark_doc_search` called, returned "SEARCHED: no results" without hanging |
| 6 | E2E tool-use smoke (blocked tool) | PASS — `lark_im_send` not in allowlist → replied "BLOCKED" |
| 7 | Per-chat routing proof | PASS — unit tests: bound chat → sales agent; unbound → default; distinct folderPaths |

---

## Working Headless MCP Flag Combo

```
claude -p "<prompt>" \
  --output-format json \
  --model <model> \
  --mcp-config <path-to-agent-mcp-config.json> \
  --strict-mcp-config \
  --allowedTools mcp__lark-cli__lark_doc_search mcp__lark-cli__lark_task_my ... \
  --permission-mode acceptEdits
```

- `--strict-mcp-config`: isolates to only the per-agent lark-cli server (ignores global ~/.claude/mcp.json)
- `--allowedTools` (camelCase OR `--allowed-tools` both work): per-agent tool subset; unlisted tools simply unavailable → Claude says "BLOCKED" / "cannot use that tool", no hang
- `--permission-mode acceptEdits`: non-interactive headless mode; MCP tool calls proceed without human approval prompts
- Child process `cwd` = agent folder: CLAUDE.md auto-loaded → prompt-cache benefit

---

## Deviations from Spec

1. **`--agent` flag NOT used** (per design decision in task brief). Folder + cwd + CLAUDE.md is the model. No `--agent` confusion with Claude Code's named-subagents feature.
2. **`agent.json` replaces `mcp.json`** (DRY/KISS per brief). One manifest file contains name, model, effort, allowedTools, enabled. Registry generates the runtime `--mcp-config` JSON under `bridge/data/mcp-configs/`.
3. **Engine integration is graceful**: if registry is empty (no agents loaded), resolveAgent throws → engine catches and logs warn, proceeds with no-agent config (basic claude -p). Existing tests that don't seed agents still pass.
4. **Path bug fixed**: `agent-registry.ts` AGENTS_DIR was initially `../../../agents` (3 levels up = wrong). Corrected to `../../agents` (two levels up from `src/agents/` = `bridge/`). Also added `process.env["AGENTS_DIR"]` override for test flexibility.

---

## Unresolved Questions

None for phase-05. Phase-06 notes:
- resolveAgent graceful fallback means no-agent runs accumulate cost without attribution — phase-06 user upsert + quota_usage row will need the resolved agentId, now correctly threaded via `resolvedAgentId`.
