// API route: POST /api/bindings — rebind a chat to a different agent.
// Body: { projectId, chatId, agentId } — validated with zod.
// Mirrors the INSERT … ON CONFLICT … DO UPDATE pattern from binding-store.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/admin-db";

export const dynamic = "force-dynamic";

const RebindSchema = z.object({
  projectId: z.number().int().positive(),
  chatId: z.string().min(1),
  agentId: z.number().int().positive(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = RebindSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { projectId, chatId, agentId } = parsed.data;
  const db = getAdminDb();

  // Verify agent belongs to project
  const agent = db
    .prepare(`SELECT id FROM agents WHERE id = ? AND project_id = ? LIMIT 1`)
    .get(agentId, projectId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found in project" }, { status: 404 });
  }

  db.prepare(
    `INSERT INTO chat_bindings (project_id, chat_id, agent_id, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (project_id, chat_id)
     DO UPDATE SET agent_id = excluded.agent_id, enabled = 1`,
  ).run(projectId, chatId, agentId);

  return NextResponse.json({ ok: true });
}

// PATCH /api/bindings — toggle binding enabled flag
const ToggleSchema = z.object({
  projectId: z.number().int().positive(),
  chatId: z.string().min(1),
  enabled: z.boolean(),
});

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = ToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { projectId, chatId, enabled } = parsed.data;
  const db = getAdminDb();

  db.prepare(
    `UPDATE chat_bindings SET enabled = ? WHERE project_id = ? AND chat_id = ?`,
  ).run(enabled ? 1 : 0, projectId, chatId);

  return NextResponse.json({ ok: true });
}
