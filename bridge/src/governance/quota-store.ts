// quota-store.ts — per-user quota state: upsertUser, getUsageToday, cap read/write.
// Rolls up quota_usage rows by date(created_at) — no extra tables (YAGNI).

import type Database from "better-sqlite3";

export interface DailyUsage {
  msgCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalNotionalCostUsd: number;
}

export interface UserQuotaState {
  userId: number;
  quotaCap: number | null;
  cohort: string;
  riskScore: number;
}

/**
 * Upsert a user row (idempotent). Creates the user if not present.
 * Returns the internal numeric user id.
 */
export function upsertUser(
  db: Database.Database,
  projectId: number,
  larkUserId: string,
  displayName?: string,
): number {
  db.prepare<[number, string, string]>(
    `INSERT INTO users (project_id, lark_user_id, display_name)
     VALUES (?, ?, ?)
     ON CONFLICT (project_id, lark_user_id) DO UPDATE SET
       display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE users.display_name END`,
  ).run(projectId, larkUserId, displayName ?? "");

  const row = db
    .prepare<[number, string], { id: number }>(
      `SELECT id FROM users WHERE project_id = ? AND lark_user_id = ? LIMIT 1`,
    )
    .get(projectId, larkUserId);

  if (!row) throw new Error(`upsertUser failed for lark_user_id=${larkUserId}`);
  return row.id;
}

/**
 * Get today's rolled-up usage for a user (UTC date).
 * Aggregates quota_usage rows where date(created_at) = today.
 */
export function getUsageToday(db: Database.Database, userId: number): DailyUsage {
  const row = db
    .prepare<
      [number],
      {
        msg_count: number;
        total_input: number;
        total_output: number;
        total_cache_read: number;
        total_cache_write: number;
        total_cost: number;
      }
    >(
      `SELECT
         COUNT(*) as msg_count,
         COALESCE(SUM(input_tokens), 0) as total_input,
         COALESCE(SUM(output_tokens), 0) as total_output,
         COALESCE(SUM(cache_read_tokens), 0) as total_cache_read,
         COALESCE(SUM(cache_write_tokens), 0) as total_cache_write,
         COALESCE(SUM(notional_cost_usd), 0) as total_cost
       FROM quota_usage
       WHERE user_id = ?
         AND date(created_at) = date('now')`,
    )
    .get(userId);

  if (!row) {
    return {
      msgCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalNotionalCostUsd: 0,
    };
  }

  return {
    msgCount: row.msg_count,
    totalInputTokens: row.total_input,
    totalOutputTokens: row.total_output,
    totalCacheReadTokens: row.total_cache_read,
    totalCacheWriteTokens: row.total_cache_write,
    totalNotionalCostUsd: row.total_cost,
  };
}

/** Read quota state (cap, cohort, risk_score) for a user. */
export function getUserQuotaState(db: Database.Database, userId: number): UserQuotaState | null {
  const row = db
    .prepare<[number], { id: number; quota_cap: number | null; cohort: string; risk_score: number }>(
      `SELECT id, quota_cap, cohort, risk_score FROM users WHERE id = ? LIMIT 1`,
    )
    .get(userId);

  if (!row) return null;
  return { userId: row.id, quotaCap: row.quota_cap, cohort: row.cohort, riskScore: row.risk_score };
}

/** Write a new quota_cap for a user (used by auto-tighten and manual override). */
export function setQuotaCap(db: Database.Database, userId: number, cap: number | null): void {
  db.prepare<[number | null, number]>(`UPDATE users SET quota_cap = ? WHERE id = ?`).run(cap, userId);
}

/** Write cohort + risk_score for a user (used by classifier). */
export function updateUserCohort(
  db: Database.Database,
  userId: number,
  cohort: string,
  riskScore: number,
): void {
  db.prepare<[string, number, number]>(
    `UPDATE users SET cohort = ?, risk_score = ? WHERE id = ?`,
  ).run(cohort, riskScore, userId);
}
