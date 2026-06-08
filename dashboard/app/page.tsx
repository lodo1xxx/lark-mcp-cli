// Dashboard page — live status + today's key metrics.
// Server component renders static stats; LiveGauges client island polls every 5s.

import { getDashboardStats, getTopSpendersToday } from "@/lib/queries";
import { readBridgeStatus } from "@/lib/status";
import { LiveGauges } from "@/components/live-gauges";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const stats = getDashboardStats();
  const topSpenders = getTopSpendersToday(5);
  const status = readBridgeStatus();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            status.online
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.online ? "bg-green-500" : "bg-red-400"}`}
          />
          {status.online ? "Bridge online" : "Bridge offline"}
        </span>
      </div>

      {/* Today's static stats (server-rendered) */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Today</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Active users (24 h)" value={stats.activeUsers24h} />
          <StatCard label="Messages today" value={stats.messagesToday} />
          <StatCard
            label="Notional spend today"
            value={`$${stats.notionalSpendToday.toFixed(4)}`}
          />
          <StatCard label="Quota denies today" value={stats.quotaDeniesToday} />
        </div>
      </section>

      {/* Live gauges — client island, polls /api/gauges every 5s */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Live engine gauges</h2>
        <LiveGauges initialStatus={status} />
      </section>

      {/* Top spenders today */}
      {topSpenders.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Top spenders today (notional)</h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">User</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Messages</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Notional cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {topSpenders.map((s) => (
                  <tr key={s.lark_user_id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                      {s.display_name || s.lark_user_id}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700">{s.msg_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-700">
                      ${s.total_cost.toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
