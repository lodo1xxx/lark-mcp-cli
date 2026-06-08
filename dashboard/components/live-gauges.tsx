"use client";

import { useEffect, useState } from "react";
import type { BridgeStatus } from "@/lib/status";

interface GaugeResponse {
  inFlight: number;
  queued: number;
  online: boolean;
  uptimeMs: number;
}

export function LiveGauges({ initialStatus }: { initialStatus: BridgeStatus }) {
  const [data, setData] = useState<GaugeResponse>({
    inFlight: initialStatus.inFlight,
    queued: initialStatus.queued,
    online: initialStatus.online,
    uptimeMs: initialStatus.uptimeMs,
  });

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/gauges");
        if (res.ok) setData(await res.json());
      } catch {
        // ignore — stale data stays shown
      }
    };
    const id = setInterval(poll, 5000);
    poll();
    return () => clearInterval(id);
  }, []);

  const fmtUptime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">In-flight</p>
        <p className={`mt-2 text-3xl font-semibold ${data.inFlight > 0 ? "text-blue-600" : "text-zinc-900"}`}>
          {data.inFlight}
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Queued</p>
        <p className={`mt-2 text-3xl font-semibold ${data.queued > 0 ? "text-amber-500" : "text-zinc-900"}`}>
          {data.queued}
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Uptime</p>
        <p className="mt-2 text-3xl font-semibold text-zinc-900">
          {data.online ? fmtUptime(data.uptimeMs) : "—"}
        </p>
      </div>
    </div>
  );
}
