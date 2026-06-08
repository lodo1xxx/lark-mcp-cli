// output-parser.ts — parse --output-format json envelope from `claude -p`.
//
// CONFIRMED FIELD MAP (live-sampled 2026-06-08, resume durability CONFIRMED):
//   reply text        → result
//   session id        → session_id
//   cost (raw)        → total_cost_usd
//   input tokens      → usage.input_tokens
//   output tokens     → usage.output_tokens
//   cache read        → usage.cache_read_input_tokens
//   cache write       → usage.cache_creation_input_tokens  (stored as cache_write_tokens)
//   error signal      → is_error === true OR subtype !== "success"
//
// RESUME DURABILITY: confirmed — `--resume <session_id>` carries full context.
// Second call ("What name did I give you?") returned "Bridge" correctly.
// Session IDs are stable within a session window (exact expiry unknown — SESSION_LOST handles stale ids).
//
// Envelope may have leading/trailing whitespace. If multiple JSON objects appear
// (stream-json fallback), use the LAST complete one.

import { EngineError, type RunResult } from "./engine-types.js";

interface ClaudeEnvelope {
  type: string;
  subtype: string;
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

/** Extract the last complete JSON object from stdout (handles stray lines). */
function extractLastJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Fast path: entire string is one JSON object
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to line scan
    }
  }
  // Scan lines for last parseable JSON object
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function parseEnvelope(stdout: string): RunResult {
  const parsed = extractLastJson(stdout);

  if (!parsed || typeof parsed !== "object") {
    throw new EngineError("BAD_OUTPUT", `Cannot parse claude output: ${stdout.slice(0, 200)}`);
  }

  const env = parsed as Partial<ClaudeEnvelope>;

  if (env.is_error === true || env.subtype !== "success") {
    throw new EngineError(
      "BAD_OUTPUT",
      `Claude returned error envelope: subtype=${env.subtype ?? "unknown"} result=${String(env.result ?? "").slice(0, 200)}`,
    );
  }

  if (typeof env.result !== "string" || typeof env.session_id !== "string") {
    throw new EngineError("BAD_OUTPUT", `Envelope missing required fields: ${JSON.stringify(env).slice(0, 300)}`);
  }

  const usage = env.usage ?? {};

  return {
    text: env.result,
    sessionId: env.session_id,
    usage: {
      inputTokens: (usage as Record<string, number>)["input_tokens"] ?? 0,
      outputTokens: (usage as Record<string, number>)["output_tokens"] ?? 0,
      cacheReadTokens: (usage as Record<string, number>)["cache_read_input_tokens"] ?? 0,
      cacheWriteTokens: (usage as Record<string, number>)["cache_creation_input_tokens"] ?? 0,
    },
    notionalCostUsd: env.total_cost_usd ?? 0,
    raw: parsed,
  };
}
