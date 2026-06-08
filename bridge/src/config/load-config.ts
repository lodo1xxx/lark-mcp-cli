// Config loader: reads config.json, applies env overrides, validates with zod.
// NEVER put secrets (app_secret, tokens) in config.json or here.
// Lark app_secret lives only in lark-cli's own auth store / env vars.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RateTableSchema = z.object({
  inputPerMtok: z.number().positive().default(3.0),
  outputPerMtok: z.number().positive().default(15.0),
  cacheReadPerMtok: z.number().positive().default(0.30),
  cacheWritePerMtok: z.number().positive().default(3.75),
}).default({});

const AutoTightenSchema = z.object({
  spamDenyRate: z.number().min(0).max(1).default(0.4),
  spamVolume: z.number().int().min(1).default(15),
  capReductionFactor: z.number().min(0.1).max(1).default(0.5),
  capFloor: z.number().int().min(1).default(5),
}).default({});

const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(9820),
  lark_app_id: z.string().min(1),
  claude_binary: z.string().min(1).default("claude"),
  lark_cli_binary: z.string().min(1),
  db_path: z.string().min(1).default("./data/bridge.db"),
  default_model: z.string().default("sonnet"),
  queue_concurrency: z.number().int().min(1).max(32).default(4),
  queue_timeout_ms: z.number().int().min(1000).default(120000),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Display name of the bot in Lark — used to strip @mention prefix from text. */
  bot_display_name: z.string().min(1).default("Bot"),
  /** Claude engine: path or name of the claude binary (default: "claude" on PATH). */
  engine_claude_binary: z.string().min(1).default("claude"),
  /** Max parallel claude invocations (default 1 = serial, protects OAuth rate window). */
  engine_concurrency: z.number().int().min(1).max(16).default(1),
  /** Per-invocation timeout in ms (default 180 s). */
  engine_timeout_ms: z.number().int().min(1000).default(180_000),
  /** Max chars per reply chunk sent to Lark (default 3000). */
  reply_max_chars: z.number().int().min(100).max(10000).default(3000),

  // ── Governance (Phase-06) ──────────────────────────────────────────────────
  /** Max messages per user per day (NOTIONAL fairness cap, not billing). Default 50. */
  daily_message_cap: z.number().int().min(0).default(50),
  /** Reference Sonnet per-Mtok rates for NOTIONAL cost computation (fallback only). */
  rate_table: RateTableSchema,
  /** Interval between governance sweeps in ms (default 5 min). */
  classifier_interval_ms: z.number().int().min(10000).default(300_000),
  /** Auto-tighten thresholds. */
  auto_tighten: AutoTightenSchema,
  /** If true, send /help nudge to stuck users during scheduler sweep. */
  stuck_nudge_enabled: z.boolean().default(false),
});

export type BridgeConfig = z.infer<typeof ConfigSchema>;

function readConfigFile(): Record<string, unknown> {
  // Look for config.json next to the bridge root (two dirs up from src/config/)
  const candidates = [
    resolve(__dirname, "../../config.json"),
    resolve(process.cwd(), "config.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Failed to parse config file at ${p}: ${String(err)}`);
      }
    }
  }
  return {};
}

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = { ...raw };

  if (process.env["BRIDGE_PORT"]) {
    overrides["port"] = parseInt(process.env["BRIDGE_PORT"], 10);
  }
  if (process.env["LARK_APP_ID"]) {
    overrides["lark_app_id"] = process.env["LARK_APP_ID"];
  }
  if (process.env["BRIDGE_DB_PATH"]) {
    overrides["db_path"] = process.env["BRIDGE_DB_PATH"];
  }
  if (process.env["CLAUDE_BINARY"]) {
    overrides["claude_binary"] = process.env["CLAUDE_BINARY"];
  }
  if (process.env["LARK_CLI_BINARY"]) {
    overrides["lark_cli_binary"] = process.env["LARK_CLI_BINARY"];
  }
  if (process.env["BRIDGE_LOG_LEVEL"]) {
    overrides["log_level"] = process.env["BRIDGE_LOG_LEVEL"];
  }

  return overrides;
}

let _config: BridgeConfig | null = null;

export function loadConfig(): BridgeConfig {
  if (_config) return _config;

  const raw = readConfigFile();
  const merged = applyEnvOverrides(raw);
  const result = ConfigSchema.safeParse(merged);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Bridge config validation failed:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

/** Reset cached config (useful in tests) */
export function resetConfig(): void {
  _config = null;
}
