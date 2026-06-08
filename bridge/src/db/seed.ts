// Idempotent seed script: inserts 1 project.
// Agents are NOT seeded here — the agent registry (src/agents/agent-registry.ts)
// owns them by scanning bridge/agents/<name>/ on boot. Seeding an agent here too
// created a duplicate "Default Agent" that outranked the folder "default" in the
// router's id-ASC fallback, so router and engine disagreed on the default agent.
// Re-running is safe — INSERT OR IGNORE on the project.
// Run: npm run seed

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "./client.js";
import { migrate } from "./migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Seed data ─────────────────────────────────────────────────────────────────
// lark_app_id is NOT a secret — it's a public identifier for the Lark application.
const SEED_PROJECT = {
  lark_app_id: "cli_a9707ccfdea25ed1",
  name: "Lark Claude Bridge (default)",
  status: "active",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedProject(): number {
  const db = getDb();

  db.prepare(`
    INSERT OR IGNORE INTO projects (lark_app_id, name, status)
    VALUES (@lark_app_id, @name, @status)
  `).run(SEED_PROJECT);

  const row = db
    .prepare("SELECT id FROM projects WHERE lark_app_id = ?")
    .get(SEED_PROJECT.lark_app_id) as { id: number } | undefined;

  if (!row) throw new Error("Failed to find/insert seed project");
  return row.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function seed(): void {
  migrate();

  console.log("[seed] Seeding project…");
  const projectId = seedProject();
  console.log(`[seed] Project id=${projectId} (${SEED_PROJECT.lark_app_id})`);
  console.log("[seed] Agents are loaded from bridge/agents/ by the registry — not seeded here.");

  console.log("[seed] Done.");
}

// Run directly: tsx src/db/seed.ts
if (__filename === resolve(process.argv[1] ?? "")) {
  seed();
  closeDb();
  process.exit(0);
}
