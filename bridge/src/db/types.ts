// Row interfaces matching schema.sql — kept in sync manually.
// All date fields are ISO-8601 strings (SQLite stores as TEXT).

export interface ProjectRow {
  id: number;
  lark_app_id: string;
  name: string;
  status: "active" | "disabled";
  created_at: string;
}

export interface AgentRow {
  id: number;
  project_id: number;
  name: string;
  folder_path: string;
  model: string;
  effort: string | null;
  enabled: 0 | 1;
  created_at: string;
}

export interface ChatBindingRow {
  id: number;
  project_id: number;
  chat_id: string;
  agent_id: number;
  enabled: 0 | 1;
}

export interface SessionRow {
  chat_id: string;
  project_id: number;
  agent_id: number;
  claude_session_id: string | null;
  last_active_at: string;
  message_count: number;
}

export interface MessageRow {
  id: number;
  chat_id: string;
  lark_message_id: string;
  direction: "inbound" | "outbound";
  user_id: string | null;
  content: string;
  claude_session_id: string | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  project_id: number;
  lark_user_id: string;
  display_name: string;
  cohort: string;
  risk_score: number;
  quota_cap: number | null;
  created_at: string;
}

export interface QuotaUsageRow {
  id: number;
  user_id: number;
  message_id: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  notional_cost_usd: number;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  project_id: number;
  chat_id: string | null;
  user_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
}
