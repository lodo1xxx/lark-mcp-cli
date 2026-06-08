// Audit page — paginated audit_log with filters (chatId/userId/eventType).
// Server component; filters come from URL search params.

import { getAuditPage, getDistinctEventTypes } from "@/lib/queries";
import Link from "next/link";

interface PageProps {
  searchParams: Promise<{
    chatId?: string;
    userId?: string;
    eventType?: string;
    page?: string;
  }>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? "1", 10) || 1;

  const result = getAuditPage({
    chatId: sp.chatId || undefined,
    userId: sp.userId || undefined,
    eventType: sp.eventType || undefined,
    page,
    pageSize: 50,
  });

  const eventTypes = getDistinctEventTypes();
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { chatId: sp.chatId, userId: sp.userId, eventType: sp.eventType, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    return `/audit?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit Log</h1>

      {/* Filters */}
      <form method="GET" action="/audit" className="flex flex-wrap gap-3">
        <input
          name="chatId"
          defaultValue={sp.chatId ?? ""}
          placeholder="Filter by chat ID"
          className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 placeholder-zinc-400"
        />
        <input
          name="userId"
          defaultValue={sp.userId ?? ""}
          placeholder="Filter by user ID"
          className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 placeholder-zinc-400"
        />
        <select
          name="eventType"
          defaultValue={sp.eventType ?? ""}
          className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700"
        >
          <option value="">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-zinc-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Filter
        </button>
        <Link
          href="/audit"
          className="rounded border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
        >
          Clear
        </Link>
      </form>

      <p className="text-xs text-zinc-400">
        {result.total} events · page {page} of {totalPages}
      </p>

      {/* Event table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        {result.rows.length === 0 ? (
          <p className="p-4 text-sm text-zinc-400">No events match the current filter.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">ID</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Time</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Event</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Chat</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">User</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {result.rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2 text-xs text-zinc-400">{row.id}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500 whitespace-nowrap">
                    {row.created_at}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700">
                      {row.event_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500 max-w-[120px] truncate">
                    {row.chat_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500 max-w-[120px] truncate">
                    {row.user_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-400 max-w-xs truncate">
                    {row.payload_json}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={buildUrl({ page: String(page - 1) })}
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            ← Prev
          </Link>
        )}
        {page < totalPages && (
          <Link
            href={buildUrl({ page: String(page + 1) })}
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
