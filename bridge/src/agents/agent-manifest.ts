// agent-manifest.ts — read and validate one agent folder's agent.json.
// Returns a typed Agent with resolved absolute paths.

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";

// All 21 lark-cli MCP short tool names
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

const AgentManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/, "name must be kebab/snake-case"),
  model: z.string().min(1),
  effort: z.enum(["low", "normal", "high"]).nullable().optional(),
  allowedTools: z.array(z.enum(LARK_TOOL_NAMES)).min(1),
  enabled: z.boolean().default(true),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export interface Agent {
  name: string;
  folderPath: string;      // absolute path to agent directory
  claudeMdPath: string;    // absolute path to CLAUDE.md
  model: string;
  effort: string | null;
  allowedTools: LarkToolName[];
  enabled: boolean;
}

/**
 * Parse and validate one agent folder. Throws on invalid manifest or missing CLAUDE.md.
 */
export function loadAgentManifest(folderPath: string): Agent {
  const absFolder = resolve(folderPath);
  const manifestPath = join(absFolder, "agent.json");
  const claudeMdPath = join(absFolder, "CLAUDE.md");

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing agent.json in ${absFolder}`);
  }
  if (!existsSync(claudeMdPath)) {
    throw new Error(`Missing CLAUDE.md in ${absFolder}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${String(err)}`);
  }

  const parsed = AgentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid agent.json in ${absFolder}: ${parsed.error.message}`);
  }

  const manifest = parsed.data;

  return {
    name: manifest.name,
    folderPath: absFolder,
    claudeMdPath,
    model: manifest.model,
    effort: manifest.effort ?? null,
    allowedTools: manifest.allowedTools,
    enabled: manifest.enabled,
  };
}
