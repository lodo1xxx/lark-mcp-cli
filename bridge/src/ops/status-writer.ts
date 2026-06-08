// status-writer.ts — writes bridge/data/status.json every ~3s with live gauges.
// Dashboard reads this file; if stale (>15s) it shows "bridge offline".

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface StatusSnapshot {
  inFlight: number;
  queued: number;
  uptimeMs: number;
  lastEventAt: string | null;
  pid: number;
  updatedAt: string;
}

export interface GaugeReader {
  inFlight: number;
  queued: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATUS_PATH = resolve(__dirname, "../../data/status.json");
const INTERVAL_MS = 3000;

let _timer: NodeJS.Timeout | null = null;
let _startedAt = Date.now();
let _lastEventAt: string | null = null;

/** Call this whenever a Lark event is processed to update lastEventAt. */
export function markEvent(): void {
  _lastEventAt = new Date().toISOString();
}

function write(gauges: GaugeReader): void {
  const snap: StatusSnapshot = {
    inFlight: gauges.inFlight,
    queued: gauges.queued,
    uptimeMs: Date.now() - _startedAt,
    lastEventAt: _lastEventAt,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(STATUS_PATH, JSON.stringify(snap));
  } catch {
    // non-fatal — dashboard will show stale after 15s
  }
}

/**
 * Start writing status.json at ~3s intervals.
 * @param getGauges - function returning current inFlight/queued values
 */
export function startStatusWriter(getGauges: () => GaugeReader): void {
  _startedAt = Date.now();
  write(getGauges());
  _timer = setInterval(() => write(getGauges()), INTERVAL_MS);
  _timer.unref(); // don't block process exit
}

/** Stop the writer (call on shutdown). */
export function stopStatusWriter(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
