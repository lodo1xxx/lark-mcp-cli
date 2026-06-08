// mcp-allowlist.ts — generate per-agent --mcp-config file and compute allowed tool names.
// The lark-cli MCP server exposes all 21 tools; restriction happens via --allowed-tools on
// the Claude side. This module writes the server config file and builds the prefixed names.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, LarkToolName } from "./agent-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Runtime output dir — gitignored (bridge/data/ is already in .gitignore)
const RUNTIME_DIR = resolve(__dirname, "../../data/mcp-configs");

// lark-cli binary location — prefer env override for tests/CI
function getLarkCliBinary(): string {
  return process.env["LARK_CLI_BIN"] ?? "/Users/lodo/.npm-global/bin/lark-cli";
}

/** MCP prefix used by Claude for tool names from a named server */
const MCP_PREFIX = "mcp__lark-cli__";

/** Convert short tool name → fully-qualified MCP tool name */
export function toMcpToolName(shortName: LarkToolName): string {
  return `${MCP_PREFIX}${shortName}`;
}

export interface McpAllowlist {
  mcpConfigPath: string;
  allowedToolNames: string[];  // prefixed mcp__lark-cli__<name>
}

/**
 * Ensure the per-agent --mcp-config JSON is written and return config path + allowed names.
 * Call once at registry load; safe to call again (idempotent write).
 */
export function buildMcpAllowlist(agent: Agent): McpAllowlist {
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const mcpConfig = {
    mcpServers: {
      "lark-cli": {
        command: getLarkCliBinary(),
        args: ["mcp", "serve"],
        env: { NO_COLOR: "1" },
      },
    },
  };

  const configPath = join(RUNTIME_DIR, `${agent.name}.json`);
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

  const allowedToolNames = agent.allowedTools.map(toMcpToolName);

  return {
    mcpConfigPath: resolve(configPath),
    allowedToolNames,
  };
}
