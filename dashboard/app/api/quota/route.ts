// API route: PATCH /api/quota — set per-user quota_cap.
// Body: { userId: number, cap: number | null }
// Mirrors setQuotaCap() from quota-store.ts — writes directly to bridge.db.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/admin-db";

export const dynamic = "force-dynamic";

const CapSchema = z.object({
  userId: z.number().int().positive(),
  cap: z.number().int().nonnegative().nullable(),
});

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = CapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { userId, cap } = parsed.data;
  const db = getAdminDb();

  const user = db.prepare(`SELECT id FROM users WHERE id = ? LIMIT 1`).get(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  db.prepare(`UPDATE users SET quota_cap = ? WHERE id = ?`).run(cap, userId);

  return NextResponse.json({ ok: true });
}
