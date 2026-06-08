// claude-runner.ts — spawn `claude -p` via argv array (no shell interpolation).
// Security: ANTHROPIC_API_KEY is deleted from env before every spawn.
// Never log env vars or credentials.

import { spawn } from "node:child_process";
import { EngineError, type RunRequest, type RunResult } from "./engine-types.js";
import { parseEnvelope } from "./output-parser.js";

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /usage.?limit/i,
  /too.?many.?request/i,
  /quota.?exceeded/i,
  /overloaded/i,
];

function isRateLimit(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

function buildArgv(req: RunRequest): string[] {
  const args: string[] = [];

  if (req.sessionId) {
    args.push("--resume", req.sessionId);
  }

  args.push("-p", req.prompt, "--output-format", "json");

  if (req.model) args.push("--model", req.model);

  // Per-agent MCP config + tool allowlist (phase-05)
  if (req.mcpConfigPath) {
    args.push("--mcp-config", req.mcpConfigPath);
    args.push("--strict-mcp-config"); // ignore globally-configured MCP servers
  }
  if (req.allowedTools && req.allowedTools.length > 0) {
    args.push("--allowedTools", ...req.allowedTools);
  }

  // Headless non-interactive mode. The bot runs UNATTENDED — there is never a
  // human to approve a permission prompt, so any prompt would hang the run (the
  // model then narrates a non-existent "approve in UI" step). bypassPermissions
  // guarantees no prompt; the real tool boundary is --allowedTools + the Lark
  // app's own granted scopes (a tool the bot has no scope for simply fails).
  args.push("--permission-mode", "bypassPermissions");

  return args;
}

function scrubEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Security: must NOT have ANTHROPIC_API_KEY — forces OAuth path
  delete env["ANTHROPIC_API_KEY"];

  // Assert it's gone (defence-in-depth)
  if ("ANTHROPIC_API_KEY" in env) {
    throw new EngineError("SPAWN_FAILED", "ANTHROPIC_API_KEY could not be removed from env — aborting spawn");
  }

  return env;
}

export async function runClaude(
  binary: string,
  req: RunRequest,
): Promise<RunResult> {
  const env = scrubEnv();
  const args = buildArgv(req);
  const timeoutMs = req.timeoutMs ?? 180_000;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      env,
      cwd: req.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false, // explicit: never use shell (injection safety)
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new EngineError("TIMEOUT", `claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new EngineError("SPAWN_FAILED", `Failed to spawn claude: ${String(err)}`, err));
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        const combined = `${stdout}\n${stderr}`.trim();
        if (isRateLimit(combined)) {
          reject(new EngineError("RATE_LIMITED", `Claude rate-limited (exit ${code}): ${combined.slice(0, 200)}`));
          return;
        }
        // Check for session-not-found / resume errors.
        // Real Claude string: "No conversation found with session ID: <id>".
        if (
          /session.*(not found|expired|invalid)/i.test(combined) ||
          /no conversation found with session/i.test(combined) ||
          /resume.*error/i.test(combined)
        ) {
          reject(new EngineError("SESSION_LOST", `Claude session lost (exit ${code}): ${combined.slice(0, 200)}`));
          return;
        }
        reject(new EngineError("SPAWN_FAILED", `claude exited ${code}: ${combined.slice(0, 300)}`));
        return;
      }

      // Also check stderr for rate-limit signals even on exit 0
      if (isRateLimit(stderr)) {
        reject(new EngineError("RATE_LIMITED", `Claude rate-limited (stderr): ${stderr.slice(0, 200)}`));
        return;
      }

      try {
        resolve(parseEnvelope(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}
