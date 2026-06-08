// API route: PATCH /api/agents — toggle agent enabled flag.
// Body: { agentId: number, enabled: boolean }

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/admin-db";

export const dynamic = "force-dynamic";

const ToggleSchema = z.object({
  agentId: z.number().int().positive(),
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

  const { agentId, enabled } = parsed.data;
  const db = getAdminDb();

  const agent = db.prepare(`SELECT id FROM agents WHERE id = ? LIMIT 1`).get(agentId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  db.prepare(`UPDATE agents SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, agentId);

  return NextResponse.json({ ok: true });
}
