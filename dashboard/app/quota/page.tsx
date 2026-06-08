// Quota page — per-user cap vs used-today, manual override, auto-tighten history.
// QuotaCapForm is a client island for inline cap edits.

import { getUserQuotaRows, getAutoTightenHistory } from "@/lib/queries";
import { QuotaCapForm } from "@/components/quota-cap-form";

export default function QuotaPage() {
  const users = getUserQuotaRows();
  const tightenHistory = getAutoTightenHistory(50);

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Quota</h1>

      {/* Per-user quota table */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Per-user caps</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {users.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No users yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">User</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Cohort</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Used today</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Notional today</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Cap (msgs/day)</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {u.display_name || u.lark_user_id}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{u.cohort}</td>
                    <td className="px-4 py-3 text-right">{u.used_today}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      ${u.cost_today.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.quota_cap === null ? (
                        <span className="text-zinc-400">unlimited</span>
                      ) : (
                        u.quota_cap
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <QuotaCapForm userId={u.id} currentCap={u.quota_cap} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Auto-tighten history */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Auto-tighten history</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {tightenHistory.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No auto-tighten events.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">User</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {tightenHistory.map((e) => (
                  <tr key={e.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{e.created_at}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.user_id ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 max-w-xs truncate">
                      {e.payload_json}
                    </td>
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
