// agent-registry.ts — scan bridge/agents/*/, upsert agents table, in-memory map.
// Hot-reload: fs.watch with 300ms debounce. macOS fs.watch is flaky — reloadAgents()
// is the reliable explicit path; watch is best-effort.

import { readdirSync, statSync, watch } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { loadAgentManifest, type Agent } from "./agent-manifest.js";
import { buildMcpAllowlist, type McpAllowlist } from "./mcp-allowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// bridge/agents/ is two levels up from bridge/src/agents/ (src/agents → src → bridge → agents)
const AGENTS_DIR = process.env["AGENTS_DIR"] ?? resolve(__dirname, "../../agents");

export interface RegisteredAgent {
  agent: Agent;
  mcp: McpAllowlist;
  dbId: number;
}

// In-memory map: agent name → registered agent
const registry = new Map<string, RegisteredAgent>();

// ── DB upsert ─────────────────────────────────────────────────────────────────

function upsertAgent(db: Database.Database, agent: Agent): number {
  // Find or use project_id = 1 (default project from seed)
  const project = db
    .prepare<[], { id: number }>("SELECT id FROM projects ORDER BY id ASC LIMIT 1")
    .get();
  const projectId = project?.id ?? 1;

  // Try update first
  const existing = db
    .prepare<[string], { id: number }>("SELECT id FROM agents WHERE name = ? LIMIT 1")
    .get(agent.name);

  if (existing) {
    db.prepare(
      `UPDATE agents SET folder_path = ?, model = ?, effort = ?, enabled = ? WHERE id = ?`,
    ).run(agent.folderPath, agent.model, agent.effort, agent.enabled ? 1 : 0, existing.id);
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO agents (project_id, name, folder_path, model, effort, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(projectId, agent.name, agent.folderPath, agent.model, agent.effort, agent.enabled ? 1 : 0);

  return Number(result.lastInsertRowid);
}

// ── Scan + load ───────────────────────────────────────────────────────────────

function scanAgentFolders(): string[] {
  try {
    return readdirSync(AGENTS_DIR).filter((entry) => {
      try {
        return statSync(join(AGENTS_DIR, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    console.warn(`[registry] agents dir not found: ${AGENTS_DIR}`);
    return [];
  }
}

/**
 * Reload all agents from disk and upsert into DB.
 * Safe to call multiple times (idempotent).
 */
export function reloadAgents(db: Database.Database): void {
  const folders = scanAgentFolders();
  let loaded = 0;
  let skipped = 0;

  for (const name of folders) {
    const folderPath = join(AGENTS_DIR, name);
    try {
      const agent = loadAgentManifest(folderPath);
      const mcp = buildMcpAllowlist(agent);
      const dbId = upsertAgent(db, agent);
      registry.set(agent.name, { agent, mcp, dbId });
      loaded++;
    } catch (err) {
      console.warn(`[registry] skipping ${name}: ${String(err)}`);
      skipped++;
    }
  }

  console.info(`[registry] loaded ${loaded} agents, skipped ${skipped}`);
}

/** Get a registered agent by name. Returns undefined if not found. */
export function getAgent(name: string): RegisteredAgent | undefined {
  return registry.get(name);
}

/** Get all registered agents. */
export function listAgents(): RegisteredAgent[] {
  return Array.from(registry.values());
}

/** Get the default agent (first enabled one by name: "default" preferred, else first). */
export function getDefaultAgent(): RegisteredAgent | undefined {
  return registry.get("default") ?? Array.from(registry.values()).find((r) => r.agent.enabled);
}

// ── Hot-reload watcher ────────────────────────────────────────────────────────

let _watcher: ReturnType<typeof watch> | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startWatcher(db: Database.Database): void {
  if (_watcher) return; // already watching

  try {
    _watcher = watch(AGENTS_DIR, { recursive: true }, (_event, _filename) => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        console.info("[registry] change detected — reloading agents");
        reloadAgents(db);
      }, 300);
    });

    _watcher.on("error", (err) => {
      console.warn(`[registry] watcher error: ${String(err)}`);
    });
  } catch (err) {
    console.warn(`[registry] fs.watch unavailable: ${String(err)} — use reloadAgents() manually`);
  }
}

export function stopWatcher(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
}

/** Exposed for testing — clear in-memory map without touching DB */
export function clearRegistry(): void {
  registry.clear();
}
