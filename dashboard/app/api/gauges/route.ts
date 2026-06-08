// API route: GET /api/gauges — returns live bridge status from status.json.
// Polled every 5s by the LiveGauges client component.

import { NextResponse } from "next/server";
import { readBridgeStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export function GET() {
  const status = readBridgeStatus();
  return NextResponse.json({
    inFlight: status.inFlight,
    queued: status.queued,
    online: status.online,
    uptimeMs: status.uptimeMs,
    lastEventAt: status.lastEventAt,
    updatedAt: status.updatedAt,
  });
}
