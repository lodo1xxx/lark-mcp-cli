// cohort-classifier.ts — score users into behavioral cohorts + risk score.
// Cohorts: power | spam_prone | stuck | dormant | normal (default).
// Pure classify() over stats; runClassifier() sweeps the DB and persists changes.

import type Database from "better-sqlite3";
import { updateUserCohort } from "./quota-store.js";
import { audit } from "./audit-log.js";

export type Cohort = "power" | "spam_prone" | "stuck" | "dormant" | "normal";

export interface UserStats {
  /** Total messages sent (all time). */
  totalMessages: number;
  /** Messages today. */
  messagesToday: number;
  /** Fraction of requests denied (0–1). */
  denyRate: number;
  /** Days since last message (0 = today). */
  daysSinceLastMessage: number;
  /** Fraction of repeated/near-identical prompts (0–1). */
  repeatRate: number;
}

export interface ClassifyResult {
  cohort: Cohort;
  /** Risk score 0.0–1.0 — monotonically increases with deny rate and spam signals. */
  riskScore: number;
}

// Thresholds (conservative — err on the side of "normal")
const POWER_MIN_MESSAGES = 20;
const POWER_MAX_DENY_RATE = 0.1;
const SPAM_MIN_MESSAGES = 10;
const SPAM_DENY_RATE_THRESHOLD = 0.3;
const STUCK_MIN_REPEAT_RATE = 0.5;
const STUCK_MIN_MESSAGES = 3;
const DORMANT_DAYS_THRESHOLD = 7;

/**
 * Pure function: classify a user from their stats.
 * Risk score is derived from deny rate + spam signals, clamped to [0, 1].
 */
export function classifyUser(stats: UserStats): ClassifyResult {
  const { totalMessages, denyRate, daysSinceLastMessage, repeatRate, messagesToday } = stats;

  // Dormant: no activity for N days
  if (daysSinceLastMessage >= DORMANT_DAYS_THRESHOLD && totalMessages > 0) {
    return { cohort: "dormant", riskScore: Math.min(denyRate * 0.5, 0.3) };
  }

  // Spam-prone: high volume + high denial rate
  if (totalMessages >= SPAM_MIN_MESSAGES && denyRate >= SPAM_DENY_RATE_THRESHOLD) {
    const riskScore = Math.min(0.4 + denyRate * 0.6, 1.0);
    return { cohort: "spam_prone", riskScore };
  }

  // Stuck: many repeated prompts / unresolved turns
  if (totalMessages >= STUCK_MIN_MESSAGES && repeatRate >= STUCK_MIN_REPEAT_RATE) {
    return { cohort: "stuck", riskScore: Math.min(0.2 + repeatRate * 0.3, 0.6) };
  }

  // Power: high volume + low deny rate
  if (totalMessages >= POWER_MIN_MESSAGES && messagesToday >= 5 && denyRate <= POWER_MAX_DENY_RATE) {
    return { cohort: "power", riskScore: Math.min(denyRate * 0.5, 0.15) };
  }

  // Default
  return { cohort: "normal", riskScore: Math.min(denyRate * 0.4, 0.4) };
}

interface UserClassifyRow {
  id: number;
  project_id: number;
  lark_user_id: string;
  cohort: string;
  risk_score: number;
  total_messages: number;
  messages_today: number;
  deny_rate: number;
  days_since_last: number;
}

/**
 * Sweep all users: compute stats from DB, classify, persist if cohort changed.
 * Writes cohort_changed audit event on any change.
 */
export function runClassifier(db: Database.Database): void {
  const rows = db
    .prepare<[], UserClassifyRow>(
      `SELECT
         u.id,
         u.project_id,
         u.lark_user_id,
         u.cohort,
         u.risk_score,
         COALESCE(q.total_messages, 0) AS total_messages,
         COALESCE(q.messages_today, 0) AS messages_today,
         COALESCE(d.deny_count, 0) * 1.0 / NULLIF(COALESCE(q.total_messages, 0), 0) AS deny_rate,
         COALESCE(julianday('now') - julianday(MAX(q2.created_at)), 999) AS days_since_last
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS total_messages,
                SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS messages_today
         FROM quota_usage GROUP BY user_id
       ) q ON q.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS deny_count
         FROM audit_log
         WHERE event_type = 'quota_denied'
         GROUP BY user_id
       ) d ON d.user_id = CAST(u.lark_user_id AS TEXT)
       LEFT JOIN quota_usage q2 ON q2.user_id = u.id
       GROUP BY u.id`,
    )
    .all();

  for (const row of rows) {
    const stats: UserStats = {
      totalMessages: row.total_messages,
      messagesToday: row.messages_today,
      denyRate: row.deny_rate ?? 0,
      daysSinceLastMessage: Math.floor(row.days_since_last ?? 0),
      repeatRate: 0, // repeat-rate detection requires content analysis — default 0 (YAGNI)
    };

    const { cohort, riskScore } = classifyUser(stats);

    if (cohort !== row.cohort || Math.abs(riskScore - row.risk_score) > 0.01) {
      updateUserCohort(db, row.id, cohort, riskScore);
      audit(db, {
        projectId: row.project_id,
        userId: row.lark_user_id,
        eventType: "cohort_changed",
        payload: { from: row.cohort, to: cohort, riskScore },
      });
    }
  }
}
