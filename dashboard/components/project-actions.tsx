"use client";

import { useState } from "react";

type ToggleAgentProps = {
  type: "toggle-agent";
  agentId: number;
  enabled: boolean;
};

type RebindProps = {
  type: "rebind";
  projectId: number;
  chatId: string;
  currentAgentId: number;
  projectAgents: { id: number; name: string }[];
};

type ProjectActionsProps = ToggleAgentProps | RebindProps;

export function ProjectActions(props: ProjectActionsProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (props.type === "toggle-agent") {
    const { agentId, enabled } = props;
    const toggle = async () => {
      setBusy(true);
      setFeedback(null);
      try {
        const res = await fetch("/api/agents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, enabled: !enabled }),
        });
        setFeedback(res.ok ? "Saved — reload to see update" : "Error saving");
      } catch {
        setFeedback("Network error");
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          disabled={busy}
          className="rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          {busy ? "Saving…" : enabled ? "Disable" : "Enable"}
        </button>
        {feedback && <span className="text-xs text-zinc-500">{feedback}</span>}
      </div>
    );
  }

  // rebind
  const { projectId, chatId, currentAgentId, projectAgents } = props;
  const [selectedId, setSelectedId] = useState(currentAgentId);

  const rebind = async () => {
    if (selectedId === currentAgentId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, chatId, agentId: selectedId }),
      });
      setFeedback(res.ok ? "Rebound — next message uses new agent" : "Error");
    } catch {
      setFeedback("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(Number(e.target.value))}
        className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700"
      >
        {projectAgents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        onClick={rebind}
        disabled={busy || selectedId === currentAgentId}
        className="rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
      >
        {busy ? "Saving…" : "Rebind"}
      </button>
      {feedback && <span className="text-xs text-zinc-500">{feedback}</span>}
    </div>
  );
}
