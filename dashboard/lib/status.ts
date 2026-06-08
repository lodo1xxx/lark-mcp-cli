// status.ts — read bridge/data/status.json + staleness check.
// If file missing or updated >15s ago → bridge is considered offline.

import { readFileSync } from "fs";
import { resolve } from "path";

const DEFAULT_STATUS_PATH = resolve(process.cwd(), "../bridge/data/status.json");
const STATUS_PATH = process.env["BRIDGE_STATUS_PATH"] ?? DEFAULT_STATUS_PATH;
const STALE_MS = 15_000;

export interface BridgeStatus {
  inFlight: number;
  queued: number;
  uptimeMs: number;
  lastEventAt: string | null;
  pid: number;
  updatedAt: string;
  online: boolean;
}

export function readBridgeStatus(): BridgeStatus {
  const offline: BridgeStatus = {
    inFlight: 0,
    queued: 0,
    uptimeMs: 0,
    lastEventAt: null,
    pid: 0,
    updatedAt: new Date().toISOString(),
    online: false,
  };

  try {
    const raw = readFileSync(STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as BridgeStatus;
    const age = Date.now() - new Date(parsed.updatedAt).getTime();
    parsed.online = age < STALE_MS;
    return parsed;
  } catch {
    return offline;
  }
}
