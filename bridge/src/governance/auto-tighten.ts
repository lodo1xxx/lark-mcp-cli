// auto-tighten.ts — reduce quota_cap when spam thresholds are tripped.
// Conservative defaults; tighten is reversible via resetQuotaCap().
// All changes are audited (quota_auto_tightened event).

import type Database from "better-sqlite3";
import { getUsageToday, getUserQuotaState, setQuotaCap } from "./quota-store.js";
import { audit } from "./audit-log.js";

export interface AutoTightenConfig {
  /** Min deny rate (0–1) to trigger tighten (default 0.4). */
  spamDenyRate: number;
  /** Min messages today to trigger tighten (default 15). */
  spamVolume: number;
  /** Multiplier applied to current cap on tighten (default 0.5 = halve). */
  capReductionFactor: number;
  /** Absolute floor for quota_cap (default 5 msgs/day). */
  capFloor: number;
}

export const DEFAULT_AUTO_TIGHTEN_CONFIG: AutoTightenConfig = {
  spamDenyRate: 0.4,
  spamVolume: 15,
  capReductionFactor: 0.5,
  capFloor: 5,
};

export interface TightenStats {
  /** Number of quota_denied events for this user today. */
  deniedToday: number;
  /** Messages sent today (from quota_usage). */
  sentToday: number;
}

function getDeniedToday(db: Database.Database, larkUserId: string): number {
  const row = db
    .prepare<[string], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM audit_log
       WHERE event_type = 'quota_denied'
         AND user_id = ?
         AND date(created_at) = date('now')`,
    )
    .get(larkUserId);
  return row?.cnt ?? 0;
}

/**
 * Check spam thresholds for a user and tighten cap if tripped.
 * No-op if thresholds not met or cap already at floor.
 */
export function maybeTighten(
  db: Database.Database,
  userId: number,
  larkUserId: string,
  projectId: number,
  defaultCap: number,
  config: AutoTightenConfig = DEFAULT_AUTO_TIGHTEN_CONFIG,
): void {
  const state = getUserQuotaState(db, userId);
  if (!state) return;

  const usage = getUsageToday(db, userId);
  const deniedToday = getDeniedToday(db, larkUserId);
  const totalAttempts = usage.msgCount + deniedToday;
  const denyRate = totalAttempts > 0 ? deniedToday / totalAttempts : 0;

  const thresholdsMet =
    denyRate >= config.spamDenyRate && usage.msgCount >= config.spamVolume;

  if (!thresholdsMet) return;

  const currentCap = state.quotaCap ?? defaultCap;
  const newCap = Math.max(
    Math.floor(currentCap * config.capReductionFactor),
    config.capFloor,
  );

  // Already at floor — no further tightening
  if (newCap >= currentCap) return;

  setQuotaCap(db, userId, newCap);
  audit(db, {
    projectId,
    userId: larkUserId,
    eventType: "quota_auto_tightened",
    payload: { previousCap: currentCap, newCap, denyRate, msgCount: usage.msgCount },
  });
}

/**
 * Manually reset a user's quota_cap to null (= use default).
 * Provides the override path for operators / dashboard.
 */
export function resetQuotaCap(db: Database.Database, userId: number): void {
  setQuotaCap(db, userId, null);
}

/** Sweep all users and apply maybeTighten. Called by scheduler. */
export function runAutoTightenSweep(
  db: Database.Database,
  defaultCap: number,
  config: AutoTightenConfig = DEFAULT_AUTO_TIGHTEN_CONFIG,
): void {
  const users = db
    .prepare<[], { id: number; lark_user_id: string; project_id: number }>(
      `SELECT id, lark_user_id, project_id FROM users`,
    )
    .all();

  for (const user of users) {
    maybeTighten(db, user.id, user.lark_user_id, user.project_id, defaultCap, config);
  }
}
