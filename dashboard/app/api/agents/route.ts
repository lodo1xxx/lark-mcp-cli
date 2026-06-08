// API route: /api/agents — full CRUD for agent management.
// GET   — list all agents with personas
// POST  — create agent (writes folder + DB)
// PATCH — update persona | allowedTools | enabled | rename (discriminated by `field`)
// DELETE — delete agent (with safety rule)
// Bridge fs.watch reloads within 300ms after any file write.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/admin-db";
import {
  createAgent,
  updatePersona,
  updateAllowedTools,
  setEnabled,
  renameAgent,
  deleteAgent,
  readPersona,
  AgentNameSchema,
  LARK_TOOL_NAMES,
  CreateAgentSchema,
} from "@/lib/agent-admin";

export const dynamic = "force-dynamic";

// ─── GET — list agents ────────────────────────────────────────────────────────

export async function GET() {
  const db = getAdminDb();
  const rows = db.prepare(
    `SELECT a.id, a.name, a.model, a.effort, a.enabled, a.folder_path, a.created_at,
            COUNT(cb.id) as binding_count
     FROM agents a
     LEFT JOIN chat_bindings cb ON cb.agent_id = a.id AND cb.enabled = 1
     GROUP BY a.id
     ORDER BY a.name`,
  ).all() as {
    id: number; name: string; model: string; effort: string | null;
    enabled: number; folder_path: string; created_at: string; binding_count: number;
  }[];

  const agents = rows.map((r) => ({
    ...r,
    persona: readPersona(r.name) ?? "",
  }));

  return NextResponse.json({ agents });
}

// ─── POST — create agent ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const result = createAgent(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: result.name }, { status: 201 });
}

// ─── PATCH — update field ─────────────────────────────────────────────────────

const PatchPersonaSchema = z.object({
  field: z.literal("persona"),
  name: AgentNameSchema,
  persona: z.string().min(1),
});

const PatchToolsSchema = z.object({
  field: z.literal("allowedTools"),
  name: AgentNameSchema,
  allowedTools: z.array(z.enum(LARK_TOOL_NAMES)).min(1),
});

const PatchEnabledSchema = z.object({
  field: z.literal("enabled"),
  name: AgentNameSchema,
  enabled: z.boolean(),
});

const PatchRenameSchema = z.object({
  field: z.literal("rename"),
  name: AgentNameSchema,
  newName: AgentNameSchema,
});

const PatchSchema = z.discriminatedUnion("field", [
  PatchPersonaSchema,
  PatchToolsSchema,
  PatchEnabledSchema,
  PatchRenameSchema,
]);

export async function PATCH(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;
  let result;

  switch (data.field) {
    case "persona":
      result = updatePersona(data.name, data.persona);
      break;
    case "allowedTools":
      result = updateAllowedTools(data.name, data.allowedTools);
      break;
    case "enabled":
      result = setEnabled(data.name, data.enabled);
      break;
    case "rename":
      result = renameAgent(data.name, data.newName);
      break;
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: result.name });
}

// ─── DELETE — delete agent ────────────────────────────────────────────────────

const DeleteSchema = z.object({
  name: AgentNameSchema,
});

export async function DELETE(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const result = deleteAgent(parsed.data.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: result.name });
}
