"use client";

import { useState } from "react";

interface Props {
  userId: number;
  currentCap: number | null;
}

export function QuotaCapForm({ userId, currentCap }: Props) {
  const [value, setValue] = useState(currentCap?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    const cap = value.trim() === "" ? null : parseInt(value, 10);
    if (cap !== null && (isNaN(cap) || cap < 0)) {
      setFeedback("Invalid");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/quota", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, cap }),
      });
      setFeedback(res.ok ? "Saved" : "Error");
    } catch {
      setFeedback("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="number"
        min={0}
        placeholder="unlimited"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24 rounded border border-zinc-200 px-2 py-1 text-xs text-right text-zinc-700"
      />
      <button
        onClick={save}
        disabled={busy}
        className="rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
      >
        {busy ? "…" : "Set"}
      </button>
      {feedback && (
        <span className={`text-xs ${feedback === "Saved" ? "text-green-600" : "text-red-500"}`}>
          {feedback}
        </span>
      )}
    </div>
  );
}
