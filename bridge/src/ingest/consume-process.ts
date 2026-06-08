// Spawns `lark-cli event consume im.message.receive_v1 --as bot` as a
// long-lived child process and pipes stdout through the NDJSON reader.
// Auto-restarts on exit with exponential backoff (1s → 30s cap).
// STDIN is kept open (never written/ended) — lark-cli exits on stdin EOF.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createNdjsonReader } from "./ndjson-reader.js";

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const STABLE_THRESHOLD_MS = 30_000; // reset backoff after this long alive

export type EventHandler = (obj: unknown) => void;
export type ErrorHandler = (err: Error) => void;

export interface ConsumeProcessHandle {
  /** Call to permanently stop restarts and kill the child. */
  stop(): void;
}

/**
 * Start consuming events from lark-cli.
 * @param larkCliBinary  Absolute path to the lark-cli binary.
 * @param onEvent        Called for each parsed NDJSON object.
 * @param onError        Called on parse errors or unexpected exits.
 */
export function startConsumeProcess(
  larkCliBinary: string,
  onEvent: EventHandler,
  onError: ErrorHandler,
): ConsumeProcessHandle {
  let stopped = false;
  let backoffMs = BACKOFF_INITIAL_MS;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;

  function spawn_child(): void {
    if (stopped) return;

    const startedAt = Date.now();

    child = spawn(larkCliBinary, ["event", "consume", "im.message.receive_v1", "--as", "bot"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Keep stdin open — lark-cli treats EOF as shutdown signal
    // We intentionally never write or end child.stdin.

    const reader = createNdjsonReader(child.stdout);

    reader.on("data", (obj) => {
      onEvent(obj);
    });

    reader.on("error", (err) => {
      // Parse errors are non-fatal — log and continue
      onError(err);
    });

    // Pipe stderr: surface "connected"/"ready" at info level, rest at debug
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      const lines = chunk.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes("connected") || lower.includes("ready")) {
          console.info(`[consume] ${line}`);
        } else {
          // debug-gated — only print if log level allows
          if (process.env["BRIDGE_LOG_LEVEL"] === "debug") {
            console.debug(`[consume:stderr] ${line}`);
          }
        }
      }
    });

    child.on("exit", (code, signal) => {
      if (stopped) return;

      const aliveMs = Date.now() - startedAt;
      if (aliveMs >= STABLE_THRESHOLD_MS) {
        backoffMs = BACKOFF_INITIAL_MS; // reset after stable run
      }

      console.warn(
        `[consume] child exited (code=${code ?? "null"} signal=${signal ?? "null"}); ` +
          `restarting in ${backoffMs}ms`,
      );

      restartTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        spawn_child();
      }, backoffMs);
    });

    child.on("error", (err) => {
      onError(new Error(`[consume] spawn error: ${err.message}`));
    });
  }

  spawn_child();

  return {
    stop() {
      stopped = true;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (child) {
        child.kill("SIGTERM");
        child = null;
      }
    },
  };
}
