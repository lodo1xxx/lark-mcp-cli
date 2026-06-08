// agent-admin.ts — agent folder CRUD for the dashboard API routes.
// Writes to bridge/agents/<name>/ then the bridge fs.watch reloads automatically.
// DB updates are done here so the agents table stays consistent with the filesystem.
// Security: agent names validated to ^[a-z0-9-]+$ — no path traversal, no dots/slashes.

import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import { getAdminDb } from "./admin-db";

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENTS_DIR = resolve(process.cwd(), "../bridge/agents");

// All 21 Lark MCP short-names
export const LARK_TOOL_NAMES = [
  "lark_api",
  "lark_base_search",
  "lark_calendar_agenda",
  "lark_calendar_create",
  "lark_contact_search",
  "lark_doc_create",
  "lark_doc_fetch",
  "lark_doc_search",
  "lark_drive_upload",
  "lark_im_card_send",
  "lark_im_search",
  "lark_im_send",
  "lark_mail_draft_create",
  "lark_mail_send",
  "lark_minutes_search",
  "lark_okr_cycle_list",
  "lark_sheets_append",
  "lark_sheets_read",
  "lark_task_create",
  "lark_task_my",
  "lark_vc_search",
] as const;

export type LarkToolName = (typeof LARK_TOOL_NAMES)[number];

// Write-capable tools — shown with a warning badge in the UI
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "lark_api",
  "lark_calendar_create",
  "lark_doc_create",
  "lark_drive_upload",
  "lark_im_card_send",
  "lark_im_send",
  "lark_mail_draft_create",
  "lark_mail_send",
  "lark_sheets_append",
  "lark_task_create",
]);

// ─── Validation ───────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9-]+$/;

export const AgentNameSchema = z.string().min(1).max(64).regex(NAME_RE, {
  message: "Agent name must be lowercase alphanumeric with hyphens only (^[a-z0-9-]+$)",
});

export const KNOWN_MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20251001",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "sonnet",
  "opus",
  "haiku",
] as const;

export const CreateAgentSchema = z.object({
  name: AgentNameSchema,
  model: z.string().min(1).default("claude-sonnet-4-5"),
  persona: z.string().min(1),
  allowedTools: z.array(z.enum(LARK_TOOL_NAMES)).min(1),
  effort: z.enum(["low", "normal", "high"]).nullable().optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agentFolder(name: string): string {
  return join(AGENTS_DIR, name);
}

function writeAgentJson(folder: string, manifest: object): void {
  writeFileSync(join(folder, "agent.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function writeClaudeMd(folder: string, persona: string): void {
  writeFileSync(join(folder, "CLAUDE.md"), persona, "utf-8");
}

function readAgentJson(name: string): Record<string, unknown> {
  const p = join(agentFolder(name), "agent.json");
  return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
}

/** Get or create the first project_id from the DB (all agents belong to project 1). */
function getProjectId(): number {
  const db = getAdminDb();
  const row = db.prepare("SELECT id FROM projects ORDER BY id ASC LIMIT 1").get() as
    | { id: number }
    | undefined;
  return row?.id ?? 1;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AgentAdminResult {
  ok: true;
  name: string;
}

export interface AgentAdminError {
  ok: false;
  error: string;
}

export type AgentAdminOutcome = AgentAdminResult | AgentAdminError;

/** Create a new agent folder (agent.json + CLAUDE.md) and upsert DB row. */
export function createAgent(input: CreateAgentInput): AgentAdminOutcome {
  const parsed = CreateAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, model, persona, allowedTools, effort } = parsed.data;

  const folder = agentFolder(name);
  if (existsSync(folder)) {
    return { ok: false, error: `Agent '${name}' already exists` };
  }

  mkdirSync(folder, { recursive: true });
  writeAgentJson(folder, { name, model, effort: effort ?? null, allowedTools, enabled: true });
  writeClaudeMd(folder, persona);

  // Upsert into DB so registry picks it up immediately even before fs.watch fires
  const db = getAdminDb();
  const projectId = getProjectId();
  const existing = db.prepare("SELECT id FROM agents WHERE name = ? LIMIT 1").get(name) as
    | { id: number }
    | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO agents (project_id, name, folder_path, model, effort, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(projectId, name, folder, model, effort ?? null);
  } else {
    db.prepare(
      `UPDATE agents SET folder_path = ?, model = ?, effort = ?, enabled = 1 WHERE id = ?`,
    ).run(folder, model, effort ?? null, existing.id);
  }

  return { ok: true, name };
}

/** Rewrite CLAUDE.md for an existing agent. */
export function updatePersona(name: string, persona: string): AgentAdminOutcome {
  const nameCheck = AgentNameSchema.safeParse(name);
  if (!nameCheck.success) return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Invalid name" };

  const folder = agentFolder(name);
  if (!existsSync(folder)) return { ok: false, error: `Agent '${name}' not found` };

  writeClaudeMd(folder, persona);
  return { ok: true, name };
}

/** Rewrite allowedTools in agent.json — validates each tool name. */
export function updateAllowedTools(name: string, allowedTools: string[]): AgentAdminOutcome {
  const nameCheck = AgentNameSchema.safeParse(name);
  if (!nameCheck.success) return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Invalid name" };

  const toolCheck = z.array(z.enum(LARK_TOOL_NAMES)).min(1).safeParse(allowedTools);
  if (!toolCheck.success) return { ok: false, error: `Invalid tools: ${toolCheck.error.issues[0]?.message}` };

  const folder = agentFolder(name);
  if (!existsSync(folder)) return { ok: false, error: `Agent '${name}' not found` };

  const manifest = readAgentJson(name);
  manifest.allowedTools = toolCheck.data;
  writeAgentJson(folder, manifest);
  return { ok: true, name };
}

/** Set enabled flag in agent.json and DB. */
export function setEnabled(name: string, enabled: boolean): AgentAdminOutcome {
  const nameCheck = AgentNameSchema.safeParse(name);
  if (!nameCheck.success) return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Invalid name" };

  const folder = agentFolder(name);
  if (!existsSync(folder)) return { ok: false, error: `Agent '${name}' not found` };

  const manifest = readAgentJson(name);
  manifest.enabled = enabled;
  writeAgentJson(folder, manifest);

  const db = getAdminDb();
  db.prepare("UPDATE agents SET enabled = ? WHERE name = ?").run(enabled ? 1 : 0, name);
  return { ok: true, name };
}

/**
 * Rename agent: move folder, update agents row + sessions/bindings reference by stable ID.
 * Strategy: update the existing agents row name+folder_path in-place (keeps the stable PK),
 * then move the folder so fs.watch sees a new path and re-upserts the same row via name match.
 * chat_bindings reference agent_id (stable) — they are unaffected.
 */
export function renameAgent(oldName: string, newName: string): AgentAdminOutcome {
  const oldCheck = AgentNameSchema.safeParse(oldName);
  const newCheck = AgentNameSchema.safeParse(newName);
  if (!oldCheck.success) return { ok: false, error: `Old name invalid: ${oldCheck.error.issues[0]?.message}` };
  if (!newCheck.success) return { ok: false, error: `New name invalid: ${newCheck.error.issues[0]?.message}` };
  if (oldName === newName) return { ok: true, name: newName };

  const oldFolder = agentFolder(oldName);
  const newFolder = agentFolder(newName);
  if (!existsSync(oldFolder)) return { ok: false, error: `Agent '${oldName}' not found` };
  if (existsSync(newFolder)) return { ok: false, error: `Agent '${newName}' already exists` };

  // Update DB row first (keeps stable ID, bindings unaffected)
  const db = getAdminDb();
  db.prepare("UPDATE agents SET name = ?, folder_path = ? WHERE name = ?").run(newName, newFolder, oldName);

  // Rename folder (fs.watch debounce may fire and re-read the new name)
  renameSync(oldFolder, newFolder);

  // Also update the agent.json name field inside the new folder
  const manifest = readAgentJson(newName);
  manifest.name = newName;
  writeAgentJson(newFolder, manifest);

  return { ok: true, name: newName };
}

/**
 * Delete agent: safety rule — refuse if it's the only enabled agent OR has bindings
 * that would leave chats unroutable (unless another enabled agent exists as fallback).
 * Removes folder + agents row + chat_bindings for this agent.
 */
export function deleteAgent(name: string): AgentAdminOutcome {
  const nameCheck = AgentNameSchema.safeParse(name);
  if (!nameCheck.success) return { ok: false, error: nameCheck.error.issues[0]?.message ?? "Invalid name" };

  const folder = agentFolder(name);
  if (!existsSync(folder)) return { ok: false, error: `Agent '${name}' not found` };

  const db = getAdminDb();

  const agentRow = db.prepare("SELECT id, enabled FROM agents WHERE name = ? LIMIT 1").get(name) as
    | { id: number; enabled: number }
    | undefined;
  if (!agentRow) return { ok: false, error: `Agent '${name}' not found in DB` };

  // Safety: refuse if this is the only enabled agent
  const enabledCount = (
    db.prepare("SELECT COUNT(*) as n FROM agents WHERE enabled = 1").get() as { n: number }
  ).n;
  if (agentRow.enabled && enabledCount <= 1) {
    return {
      ok: false,
      error: "Cannot delete the only enabled agent — enable another agent first",
    };
  }

  // Remove chat_bindings for this agent (ON DELETE CASCADE would do it, but be explicit)
  db.prepare("DELETE FROM chat_bindings WHERE agent_id = ?").run(agentRow.id);
  db.prepare("DELETE FROM sessions WHERE agent_id = ?").run(agentRow.id);
  db.prepare("DELETE FROM agents WHERE id = ?").run(agentRow.id);

  rmSync(folder, { recursive: true, force: true });
  return { ok: true, name };
}

/** Read CLAUDE.md persona text for an agent. */
export function readPersona(name: string): string | null {
  const p = join(agentFolder(name), "CLAUDE.md");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}
