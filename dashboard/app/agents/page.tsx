// Agents page — full CRUD: create, edit persona, permissions, rename, delete, toggle.
// Server component reads agents from DB + disk; interactive bits use AgentActions client island.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllAgents, getAgentUsageRollup } from "@/lib/queries";
import { readPersona, WRITE_TOOLS } from "@/lib/agent-admin";
import { AgentActions } from "@/components/agent-actions";

const ALL_TOOLS = [
  "lark_api", "lark_base_search", "lark_calendar_agenda", "lark_calendar_create",
  "lark_contact_search", "lark_doc_create", "lark_doc_fetch", "lark_doc_search",
  "lark_drive_upload", "lark_im_card_send", "lark_im_search", "lark_im_send",
  "lark_mail_draft_create", "lark_mail_send", "lark_minutes_search", "lark_okr_cycle_list",
  "lark_sheets_append", "lark_sheets_read", "lark_task_create", "lark_task_my", "lark_vc_search",
] as const;

function readAllowedTools(folderPath: string): string[] {
  const p = join(folderPath, "agent.json");
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as { allowedTools?: string[] };
    return raw.allowedTools ?? [];
  } catch { return []; }
}

export default function AgentsPage() {
  const agents = getAllAgents();
  const usageMap = new Map(getAgentUsageRollup().map((r) => [r.agent_id, r]));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <AgentActions type="create" allTools={[...ALL_TOOLS]} />
      </div>

      {agents.length === 0 && (
        <p className="text-zinc-500">No agents found. Create one above.</p>
      )}

      <div className="space-y-4">
        {agents.map((agent) => {
          const usage = usageMap.get(agent.id);
          const persona = readPersona(agent.name) ?? "";
          const allowedTools = readAllowedTools(agent.folder_path);

          return (
            <div
              key={agent.id}
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4"
            >
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-zinc-900">{agent.name}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                  {agent.model}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    agent.enabled
                      ? "bg-blue-50 text-blue-700"
                      : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  {agent.enabled ? "enabled" : "disabled"}
                </span>
                <span className="text-xs text-zinc-400">
                  {agent.binding_count} binding{agent.binding_count !== 1 ? "s" : ""}
                </span>
                {usage && usage.run_count > 0 && (
                  <span className="text-xs text-zinc-400">
                    {usage.run_count} runs &middot; {usage.total_tokens.toLocaleString()} tok &middot;
                    ${usage.notional_cost_usd.toFixed(4)} notional
                  </span>
                )}
              </div>

              {/* Persona preview */}
              {persona && (
                <p className="text-xs text-zinc-500 line-clamp-2 whitespace-pre-wrap">
                  {persona.slice(0, 220)}{persona.length > 220 ? "…" : ""}
                </p>
              )}

              {/* Tool chips */}
              {allowedTools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allowedTools.map((t) => (
                    <span
                      key={t}
                      className={`rounded px-2 py-0.5 text-xs font-mono ${
                        WRITE_TOOLS.has(t)
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                      title={WRITE_TOOLS.has(t) ? "write/destructive tool" : undefined}
                    >
                      {t}{WRITE_TOOLS.has(t) ? " !" : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Action row */}
              <div className="flex flex-wrap gap-2 pt-1">
                <AgentActions type="edit-persona" name={agent.name} currentPersona={persona} />
                <AgentActions
                  type="edit-tools"
                  name={agent.name}
                  currentTools={allowedTools}
                  allTools={[...ALL_TOOLS]}
                />
                <AgentActions type="toggle" name={agent.name} enabled={agent.enabled === 1} />
                <AgentActions type="rename" name={agent.name} />
                <AgentActions type="delete" name={agent.name} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
