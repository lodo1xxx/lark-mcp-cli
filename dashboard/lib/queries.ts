// queries.ts — named read queries for all dashboard pages.
// All column names match schema.sql exactly. Read-only; uses getReadDb().

import { getReadDb } from "./db";

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  activeUsers24h: number;
  messagesToday: number;
  notionalSpendToday: number;
  quotaDeniesToday: number;
}

export function getDashboardStats(): DashboardStats {
  const db = getReadDb();

  const activeUsers24h = (db.prepare(
    `SELECT COUNT(DISTINCT user_id) as n FROM messages
     WHERE direction = 'inbound'
       AND datetime(created_at) >= datetime('now', '-24 hours')`,
  ).get() as { n: number }).n;

  const messagesToday = (db.prepare(
    `SELECT COUNT(*) as n FROM messages
     WHERE direction = 'inbound'
       AND date(created_at) = date('now')`,
  ).get() as { n: number }).n;

  const notionalSpendToday = (db.prepare(
    `SELECT COALESCE(SUM(notional_cost_usd), 0) as total FROM quota_usage
     WHERE date(created_at) = date('now')`,
  ).get() as { total: number }).total;

  const quotaDeniesToday = (db.prepare(
    `SELECT COUNT(*) as n FROM audit_log
     WHERE event_type = 'quota_denied'
       AND date(created_at) = date('now')`,
  ).get() as { n: number }).n;

  return { activeUsers24h, messagesToday, notionalSpendToday, quotaDeniesToday };
}

export interface TopSpender {
  lark_user_id: string;
  display_name: string;
  total_cost: number;
  msg_count: number;
}

export function getTopSpendersToday(limit = 5): TopSpender[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT u.lark_user_id, u.display_name,
            COALESCE(SUM(q.notional_cost_usd), 0) as total_cost,
            COUNT(q.id) as msg_count
     FROM users u
     JOIN quota_usage q ON q.user_id = u.id
     WHERE date(q.created_at) = date('now')
     GROUP BY u.id
     ORDER BY total_cost DESC
     LIMIT ?`,
  ).all(limit) as TopSpender[];
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectWithAgents {
  id: number;
  lark_app_id: string;
  name: string;
  status: string;
  agents: AgentWithBindings[];
}

export interface AgentWithBindings {
  id: number;
  project_id: number;
  name: string;
  model: string;
  enabled: number;
  bindings: ChatBindingRow[];
}

export interface ChatBindingRow {
  id: number;
  chat_id: string;
  agent_id: number;
  enabled: number;
}

export function getProjectsWithAgents(): ProjectWithAgents[] {
  const db = getReadDb();

  const projects = db.prepare(
    `SELECT id, lark_app_id, name, status FROM projects ORDER BY id`,
  ).all() as { id: number; lark_app_id: string; name: string; status: string }[];

  return projects.map((p) => {
    const agents = db.prepare(
      `SELECT id, project_id, name, model, enabled FROM agents WHERE project_id = ? ORDER BY id`,
    ).all(p.id) as { id: number; project_id: number; name: string; model: string; enabled: number }[];

    const agentsWithBindings = agents.map((a) => {
      const bindings = db.prepare(
        `SELECT id, chat_id, agent_id, enabled FROM chat_bindings WHERE agent_id = ? ORDER BY id`,
      ).all(a.id) as ChatBindingRow[];
      return { ...a, bindings };
    });

    return { ...p, agents: agentsWithBindings };
  });
}

export function getAgentsForProject(projectId: number): { id: number; name: string }[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT id, name FROM agents WHERE project_id = ? ORDER BY name`,
  ).all(projectId) as { id: number; name: string }[];
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export interface CohortCount {
  cohort: string;
  count: number;
}

export function getCohortCounts(): CohortCount[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT cohort, COUNT(*) as count FROM users GROUP BY cohort ORDER BY count DESC`,
  ).all() as CohortCount[];
}

export interface RiskyUser {
  lark_user_id: string;
  display_name: string;
  cohort: string;
  risk_score: number;
}

export function getHighRiskUsers(minScore = 0.5, limit = 20): RiskyUser[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT lark_user_id, display_name, cohort, risk_score FROM users
     WHERE risk_score >= ?
     ORDER BY risk_score DESC
     LIMIT ?`,
  ).all(minScore, limit) as RiskyUser[];
}

export interface StuckUser {
  chat_id: string;
  last_active_at: string;
  message_count: number;
}

export function getStuckSessions(staleHours = 2, limit = 10): StuckUser[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT chat_id, last_active_at, message_count FROM sessions
     WHERE datetime(last_active_at) < datetime('now', ? || ' hours')
     ORDER BY last_active_at ASC
     LIMIT ?`,
  ).all(`-${staleHours}`, limit) as StuckUser[];
}

export interface CacheStats {
  cache_read_tokens: number;
  cache_write_tokens: number;
  input_tokens: number;
  hit_pct: number;
}

export function getCacheStats(): CacheStats {
  const db = getReadDb();
  const row = db.prepare(
    `SELECT
       COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
       COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
       COALESCE(SUM(input_tokens), 0) as input_tokens
     FROM quota_usage
     WHERE date(created_at) = date('now')`,
  ).get() as { cache_read_tokens: number; cache_write_tokens: number; input_tokens: number };

  const total = row.cache_read_tokens + row.input_tokens;
  const hit_pct = total > 0 ? (row.cache_read_tokens / total) * 100 : 0;
  return { ...row, hit_pct };
}

// ─── Quota ────────────────────────────────────────────────────────────────────

export interface UserQuotaRow {
  id: number;
  lark_user_id: string;
  display_name: string;
  cohort: string;
  quota_cap: number | null;
  used_today: number;
  cost_today: number;
}

export function getUserQuotaRows(): UserQuotaRow[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT
       u.id, u.lark_user_id, u.display_name, u.cohort, u.quota_cap,
       COALESCE(SUM(CASE WHEN date(q.created_at) = date('now') THEN 1 ELSE 0 END), 0) as used_today,
       COALESCE(SUM(CASE WHEN date(q.created_at) = date('now') THEN q.notional_cost_usd ELSE 0 END), 0) as cost_today
     FROM users u
     LEFT JOIN quota_usage q ON q.user_id = u.id
     GROUP BY u.id
     ORDER BY cost_today DESC`,
  ).all() as UserQuotaRow[];
}

export interface AutoTightenEvent {
  id: number;
  chat_id: string | null;
  user_id: string | null;
  payload_json: string;
  created_at: string;
}

export function getAutoTightenHistory(limit = 50): AutoTightenEvent[] {
  const db = getReadDb();
  return db.prepare(
    `SELECT id, chat_id, user_id, payload_json, created_at FROM audit_log
     WHERE event_type = 'quota_auto_tightened'
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(limit) as AutoTightenEvent[];
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: number;
  project_id: number;
  chat_id: string | null;
  user_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface AuditFilter {
  chatId?: string;
  userId?: string;
  eventType?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function getAuditPage(filter: AuditFilter = {}): AuditPage {
  const db = getReadDb();
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, filter.pageSize ?? 50);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.chatId) { conditions.push("chat_id = ?"); params.push(filter.chatId); }
  if (filter.userId) { conditions.push("user_id = ?"); params.push(filter.userId); }
  if (filter.eventType) { conditions.push("event_type = ?"); params.push(filter.eventType); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) as n FROM audit_log ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT id, project_id, chat_id, user_id, event_type, payload_json, created_at
     FROM audit_log ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as AuditRow[];

  return { rows, total, page, pageSize };
}

export function getDistinctEventTypes(): string[] {
  const db = getReadDb();
  return (db.prepare(
    `SELECT DISTINCT event_type FROM audit_log ORDER BY event_type`,
  ).all() as { event_type: string }[]).map((r) => r.event_type);
}
