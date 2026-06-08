// quota-gate.ts — pre-run check: allow or deny a job based on daily message cap.
// Primary cap: message count (mirrors OAuth rate-window semantics).
// Cost is a secondary display metric stored in quota_usage.
// All denial reasons are typed for downstream handling.

import type Database from "better-sqlite3";
import { getUsageToday, getUserQuotaState } from "./quota-store.js";

export type DenyReason = "OVER_DAILY_CAP" | "AUTO_TIGHTENED" | "DISABLED";

export type QuotaResult =
  | { allow: true }
  | { allow: false; reason: DenyReason; msgCount: number; cap: number };

/**
 * Check whether a user is allowed to send another message today.
 * @param db         - SQLite database handle
 * @param userId     - internal numeric user id (from users.id)
 * @param defaultCap - daily message cap from config (used when user.quota_cap is null)
 */
export function checkQuota(
  db: Database.Database,
  userId: number,
  defaultCap: number,
): QuotaResult {
  const state = getUserQuotaState(db, userId);

  // If user row is missing, allow and let the engine handle it gracefully
  if (!state) return { allow: true };

  // Explicit disable via cohort
  if (state.cohort === "disabled") {
    return { allow: false, reason: "DISABLED", msgCount: 0, cap: 0 };
  }

  const effectiveCap = state.quotaCap ?? defaultCap;

  // Unlimited cap (null defaultCap would be 0 after ?? — treat 0 as unlimited)
  if (effectiveCap <= 0) return { allow: true };

  const usage = getUsageToday(db, userId);

  if (usage.msgCount >= effectiveCap) {
    // If user was auto-tightened (cap < default), signal that reason
    const reason: DenyReason =
      state.quotaCap !== null && state.quotaCap < defaultCap
        ? "AUTO_TIGHTENED"
        : "OVER_DAILY_CAP";
    return { allow: false, reason, msgCount: usage.msgCount, cap: effectiveCap };
  }

  return { allow: true };
}
