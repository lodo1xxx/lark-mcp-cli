# Phase 05 — Multi-Agent System (folder agents, registry, chat→agent binding)

## Context Links
- Overview: [plan.md](plan.md) · Prev: [phase-04](phase-04-reply-path.md)
- Pattern reference: user's GoClaw repo `/Users/lodo/Documents/vibe/GoClaw/goclaw` (cmd/agent.go, setup_agent.go, gateway_agents.go)
- Grounding: analysis "Agent = 1 folder (CLAUDE.md + skills), đổi agent = đổi folder"

## Overview
- **Priority**: P2
- **Status**: complete (2026-06-08)
- **Effort**: 1.5d
- Folder-based agents: each agent = a directory with `CLAUDE.md` + `skills/` + `mcp.json` (tool allowlist).
  A registry loads agents from disk; chats bind to an agent; the engine runs with `--agent`/`--mcp-config`
  pointed at that folder. Changing an agent = editing files, no redeploy.

## Key Insights
- Mirrors this repo's own `.claude/` layout and GoClaw's folder-agent model → proven pattern, reuse it.
- Claude CLI supports `--agent <name>`, `--agents <json>`, `--mcp-config <configs>`, `--append-system-prompt`,
  `--add-dir`, `--strict-mcp-config`. Run claude with `cwd = agent folder` so its `CLAUDE.md` + skills load and
  prompt-cache (the 83%-cache cost win). `--strict-mcp-config` enforces the per-agent tool allowlist.
- App = security boundary, Agent = role boundary. `chat_bindings(chat_id → agent_id)`. Unbound chat → project default agent.
- The 21 lark-cli MCP tools are exposed via `lark-cli mcp serve`; each agent's `mcp.json` selects which subset
  it may call (allowlist) → least privilege per role.

## Requirements
**Functional**
- Agent registry: scan `agents/` dir, load each folder's manifest (`CLAUDE.md`, `skills/`, `mcp.json`), register in `agents` table.
- Each agent declares: name, model, effort, allowed MCP tools (`mcp.json`), enabled flag.
- Bind chats to agents (`chat_bindings`); admin can rebind (API used by dashboard phase-07).
- Engine integration: when running, pass `--agent`/`cwd`/`--mcp-config`/`--strict-mcp-config` for the bound agent.
- Hot-reload registry on file change (or explicit reload endpoint) — no full restart to add an agent.

**Non-functional**
- Files < 200 lines. Agent folders live outside `src/` (e.g. `bridge/agents/<name>/`).

## Architecture
```
bridge/
  agents/
    default/
      CLAUDE.md          # role/system prompt
      skills/*.md        # skills (prompt-cached)
      mcp.json           # tool allowlist (subset of 21 lark-cli MCP tools)
    <role>/...
  src/agents/
    agent-registry.ts    # scan + load + watch agent folders
    agent-manifest.ts    # parse/validate one agent folder
    mcp-allowlist.ts     # build --mcp-config from mcp.json (wraps lark-cli mcp serve)
    binding-store.ts     # chat_bindings CRUD
    resolve-agent.ts     # chat_id → agent (binding | project default)
```
Flow: phase-02 router calls `resolve-agent(chatId)`; phase-03 `claude-runner` receives agent name + folder
cwd + mcp-config from the resolved agent.

## Related Code Files
**Create**: `bridge/src/agents/agent-registry.ts`, `agent-manifest.ts`, `mcp-allowlist.ts`, `binding-store.ts`,
`resolve-agent.ts`; `bridge/agents/default/{CLAUDE.md,skills/,mcp.json}`.
**Modify**: `bridge/src/ingest/router.ts` (use resolve-agent), `bridge/src/engine/claude-runner.ts` (accept agent cwd + mcp args).
**Delete**: none.

## Implementation Steps
1. Define agent folder contract: `CLAUDE.md` (role), `skills/*.md`, `mcp.json` (`{ allowedTools: [...] }`). Document in `agents/README.md`.
2. `agent-manifest.ts`: validate a folder, extract model/effort/allowlist, return typed Agent.
3. `agent-registry.ts`: scan `agents/`, upsert `agents` table, `fs.watch` for hot-reload.
4. `mcp-allowlist.ts`: generate a `--mcp-config` JSON pointing at `lark-cli mcp serve` but restricting tools to the allowlist; pass `--strict-mcp-config`.
5. `binding-store.ts` + `resolve-agent.ts`: chat → agent resolution with default fallback.
6. Wire router → resolve-agent; runner → `cwd=agent.folder`, `--agent`, `--mcp-config`, `--model`, `--effort`.
7. Create a 2nd sample agent to prove routing differs per chat.

## Todo List
- [x] Define + document agent folder contract (`CLAUDE.md` + skills + agent.json) — using agent.json not mcp.json (DRY)
- [x] `agent-manifest.ts` (validate/parse one folder)
- [x] `agent-registry.ts` (scan + upsert + hot-reload)
- [x] `mcp-allowlist.ts` (build --mcp-config + strict allowlist over lark-cli mcp serve)
- [x] `binding-store.ts` + `resolve-agent.ts` (chat→agent, default fallback)
- [x] Wire engine/index.ts to use resolved agent (cwd, model, mcpConfigPath, allowedTools)
- [x] Ship `default/` + `sales/` sample agents; verify per-chat routing (unit + live smoke)

## Success Criteria
- Two chats bound to two different agents produce role-distinct replies.
- An agent only invokes MCP tools in its `mcp.json` allowlist (others rejected by `--strict-mcp-config`).
- Adding/editing an agent folder takes effect without restarting the daemon (hot-reload).
- Unbound chat falls back to project default agent.

## Risk Assessment
- **Prompt-cache not triggering** (loses 83% cost win) → ensure stable cwd + unchanged CLAUDE.md/skills per run; verify cache_read tokens rise.
- **MCP allowlist not enforced** → use `--strict-mcp-config`; test a denied tool.
- **fs.watch flakiness on macOS** → debounce + manual reload endpoint as fallback.

## Security Considerations
- Per-agent least-privilege tool allowlist = blast-radius control. No agent gets `lark_api` passthrough unless explicitly allowed.
- Agent folders are config/prompt only — never embed app_secret or tokens in `CLAUDE.md`/`mcp.json`.

## Next Steps
Feeds phase-06 (per-agent cost attribution) and phase-07 (dashboard agent/binding management + skills toggle).
