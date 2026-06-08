// Insights page — cohort distribution, risk scores, stuck sessions, cache efficiency,
// token breakdown, per-agent usage, run success rate.

import {
  getCohortCounts,
  getHighRiskUsers,
  getStuckSessions,
  getCacheStats,
  getTopSpendersToday,
  getAgentUsageRollup,
  getRunStats,
} from "@/lib/queries";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function fmt(n: number) { return n.toLocaleString(); }

export default function InsightsPage() {
  const cohorts = getCohortCounts();
  const riskyUsers = getHighRiskUsers(0.5, 20);
  const stuckSessions = getStuckSessions(2, 10);
  const cache = getCacheStats();
  const topSpenders = getTopSpendersToday(10);
  const agentUsage = getAgentUsageRollup();
  const runs = getRunStats(1);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Insights</h1>

      {/* Token breakdown — today */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Token breakdown (today)</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Fresh input" value={fmt(cache.input_tokens)} sub="newly computed" />
          <StatCard label="Cache read" value={fmt(cache.cache_read_tokens)} sub="served from cache" />
          <StatCard label="Cache write" value={fmt(cache.cache_write_tokens)} sub="written to cache" />
          <StatCard label="Output" value={fmt(cache.output_tokens)} sub="generated tokens" />
          <StatCard
            label="Total"
            value={fmt(cache.total_tokens)}
            sub="all token types combined"
          />
        </div>
      </section>

      {/* Cache efficiency — corrected formula */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Cache efficiency (today)</h2>
        <p className="mb-3 text-xs text-zinc-400">
          Hit % = cache_read / (input + cache_read + cache_write). Denominator includes cache_write
          so the rate reflects truly served-from-cache vs all input-side tokens.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Cache reads", value: fmt(cache.cache_read_tokens) },
            { label: "Cache writes", value: fmt(cache.cache_write_tokens) },
            { label: "Hit %", value: `${cache.hit_pct.toFixed(1)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Run success rate */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Run success rate (today)</h2>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Attempted", value: runs.attempted },
            { label: "Succeeded", value: runs.succeeded },
            { label: "Failed", value: runs.failed },
            { label: "Success rate", value: `${runs.success_rate.toFixed(1)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Per-agent usage */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Per-agent usage (all time)</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {agentUsage.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No agent usage recorded yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Agent</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Runs</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Input</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Cache read</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Cache write</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Output</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Total</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Notional cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {agentUsage.map((a) => (
                  <tr key={a.agent_id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{a.agent_name}</td>
                    <td className="px-4 py-3 text-right text-zinc-700">{a.run_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">{fmt(a.input_tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">{fmt(a.cache_read_tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">{fmt(a.cache_write_tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">{fmt(a.output_tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-medium">{fmt(a.total_tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">${a.notional_cost_usd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Cohort distribution */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Cohort distribution</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {cohorts.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No users yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Cohort</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Users</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {cohorts.map((c) => (
                  <tr key={c.cohort} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">{c.cohort}</td>
                    <td className="px-4 py-3 text-right">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* High risk users */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">High-risk users (score &ge; 0.5)</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {riskyUsers.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No high-risk users.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">User</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Cohort</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Risk score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {riskyUsers.map((u) => (
                  <tr key={u.lark_user_id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">{u.display_name || u.lark_user_id}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{u.cohort}</td>
                    <td className="px-4 py-3 text-right font-medium text-red-600">
                      {u.risk_score.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Stuck sessions */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Stuck sessions (idle &gt; 2h)</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {stuckSessions.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No stuck sessions.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Chat ID</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Last active</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Messages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {stuckSessions.map((s) => (
                  <tr key={s.chat_id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">{s.chat_id}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{s.last_active_at}</td>
                    <td className="px-4 py-3 text-right">{s.message_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Highest spenders today */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Highest spenders today (notional)</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {topSpenders.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No usage data today.</p>
          ) : (
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
                    <td className="px-4 py-3 font-mono text-xs">{s.display_name || s.lark_user_id}</td>
                    <td className="px-4 py-3 text-right">{s.msg_count}</td>
                    <td className="px-4 py-3 text-right font-mono">${s.total_cost.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
