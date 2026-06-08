# Agent Folder Contract

Each agent lives in its own directory under `bridge/agents/<name>/`.

## Required Files

### `agent.json` — Agent manifest
```json
{
  "name": "default",
  "model": "claude-sonnet-4-5",
  "effort": null,
  "allowedTools": ["lark_doc_search", "lark_doc_fetch"],
  "enabled": true
}
```
- `name`: unique agent identifier (matches folder name)
- `model`: Claude model string passed to `--model`
- `effort`: `"low"` | `"normal"` | `"high"` | `null` (null = default)
- `allowedTools`: subset of the 21 lark-cli MCP tool short-names (see list below)
- `enabled`: set to `false` to disable without deleting

### `CLAUDE.md` — Role/system prompt
Loaded automatically when Claude runs with `cwd = agent folder`.
Write the agent's persona, role, and constraints here.
**Never embed secrets or API keys.**

## Optional Files

### `skills/*.md` — Skill files
Additional prompt context files, loaded via prompt-caching.

## Available lark-cli MCP Tools (short-names for `allowedTools`)

```
lark_api              lark_base_search      lark_calendar_agenda
lark_calendar_create  lark_contact_search   lark_doc_create
lark_doc_fetch        lark_doc_search       lark_drive_upload
lark_im_card_send     lark_im_search        lark_im_send
lark_mail_draft_create lark_mail_send       lark_minutes_search
lark_okr_cycle_list   lark_sheets_append    lark_sheets_read
lark_task_create      lark_task_my          lark_vc_search
```

> **Least privilege**: avoid `lark_api` (raw passthrough) unless strictly needed.
> Default agent uses read-only tools only.

## Runtime

The registry generates a per-agent MCP config JSON at startup under
`bridge/data/mcp-configs/<name>.json` (gitignored). Never edit that file manually.

## Hot-reload

Edit any file in an agent folder — the registry watches for changes (300ms debounce)
and reloads automatically. Or call `reloadAgents()` explicitly.
