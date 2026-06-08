// resolve-agent.ts — resolve chatId → RegisteredAgent (binding | project default).
// Returns the full Agent + its mcp config/allowlist from the in-memory registry.

import type Database from "better-sqlite3";
import { getBinding } from "./binding-store.js";
import { getAgent, getDefaultAgent, type RegisteredAgent } from "./agent-registry.js";
import type { AgentRow } from "../db/types.js";

export interface ResolvedAgent extends RegisteredAgent {
  source: "binding" | "default";
}

/**
 * Resolve the agent for a given chatId.
 * 1. Check chat_bindings → look up agent name from agents table → find in registry.
 * 2. Fall back to in-memory default agent (name="default" or first enabled).
 * Throws if no agent can be resolved (registry not loaded or all disabled).
 */
export function resolveAgent(
  db: Database.Database,
  chatId: string,
): ResolvedAgent {
  // 1. Check binding
  const binding = getBinding(db, chatId);
  if (binding) {
    const agentRow = db
      .prepare<[number], AgentRow>("SELECT * FROM agents WHERE id = ? LIMIT 1")
      .get(binding.agentId);

    if (agentRow) {
      const registered = getAgent(agentRow.name);
      if (registered) {
        return { ...registered, source: "binding" };
      }
      // Agent in DB but not in registry — fall through to default
      console.warn(
        `[resolve-agent] agent "${agentRow.name}" (id=${binding.agentId}) not in registry — falling back`,
      );
    }
  }

  // 2. Fall back to default
  const def = getDefaultAgent();
  if (!def) {
    throw new Error(
      `[resolve-agent] No agent resolved for chat ${chatId} — registry may be empty`,
    );
  }

  return { ...def, source: "default" };
}
