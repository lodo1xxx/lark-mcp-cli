"use client";

// agent-actions.tsx — client islands for agent CRUD interactions.
// Each action type is a small self-contained component that calls /api/agents.

import { useState, useRef } from "react";

const WRITE_TOOL_SET = new Set([
  "lark_api", "lark_calendar_create", "lark_doc_create", "lark_drive_upload",
  "lark_im_card_send", "lark_im_send", "lark_mail_draft_create", "lark_mail_send",
  "lark_sheets_append", "lark_task_create",
]);

const MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20251001",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "sonnet",
  "opus",
  "haiku",
];

const DEFAULT_PERSONA_TEMPLATE = `# Agent Name

You are an AI assistant operating in the Lark workspace.

## Role
- Describe what this agent does.

## Tools
Use available Lark tools directly — never ask for permission.

## Principles
- Be concise and accurate.
- Reply in the user's language.
`;

// ─── Shared primitives ───────────────────────────────────────────────────────

function Btn({
  onClick, disabled, children, variant = "default",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "default" | "danger" | "primary";
}) {
  const cls =
    variant === "danger"
      ? "rounded border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-40"
      : variant === "primary"
      ? "rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
      : "rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40";
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

function Feedback({ msg }: { msg: string | null }) {
  if (!msg) return null;
  const isErr = msg.toLowerCase().startsWith("error") || msg.toLowerCase().includes("failed");
  return (
    <span className={`text-xs ${isErr ? "text-red-600" : "text-zinc-500"}`}>{msg}</span>
  );
}

function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-lg leading-none">
            &times;
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

async function apiFetch(method: string, body: unknown) {
  const res = await fetch("/api/agents", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { ok?: boolean; error?: string | object; name?: string };
  if (!res.ok) {
    const errMsg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    throw new Error(errMsg);
  }
  return data;
}

// ─── Create agent ────────────────────────────────────────────────────────────

type CreateProps = { type: "create"; allTools: string[] };

function CreateAgent({ allTools }: { allTools: string[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-5");
  const [persona, setPersona] = useState(DEFAULT_PERSONA_TEMPLATE);
  const [selectedTools, setSelectedTools] = useState<string[]>(["lark_doc_search", "lark_doc_fetch"]);

  const toggle = (t: string) =>
    setSelectedTools((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const submit = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("POST", { name, model, persona, allowedTools: selectedTools });
      setFeedback("Created — bridge will reload in ~300 ms");
      setTimeout(() => { setOpen(false); setFeedback(null); setName(""); }, 1500);
      window.location.reload();
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>+ Create agent</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Create agent">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Name <span className="text-zinc-400">(kebab-case, ^[a-z0-9-]+$)</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-new-agent"
              className="w-full rounded border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border border-zinc-200 px-3 py-1.5 text-sm"
            >
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Persona (CLAUDE.md)</label>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={6}
              className="w-full rounded border border-zinc-200 px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-2">
              Allowed tools <span className="text-amber-600">(! = write/destructive)</span>
            </label>
            <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
              {allTools.map((t) => (
                <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTools.includes(t)}
                    onChange={() => toggle(t)}
                    className="rounded"
                  />
                  <span className={WRITE_TOOL_SET.has(t) ? "text-amber-700 font-medium" : "text-zinc-700"}>
                    {t}{WRITE_TOOL_SET.has(t) ? " !" : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Btn variant="primary" onClick={submit} disabled={busy || !name || selectedTools.length === 0}>
              {busy ? "Creating…" : "Create"}
            </Btn>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Feedback msg={feedback} />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Edit persona ─────────────────────────────────────────────────────────────

type EditPersonaProps = { type: "edit-persona"; name: string; currentPersona: string };

function EditPersona({ name, currentPersona }: { name: string; currentPersona: string }) {
  const [open, setOpen] = useState(false);
  const [persona, setPersona] = useState(currentPersona);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("PATCH", { field: "persona", name, persona });
      setFeedback("Saved — bridge reloads in ~300 ms");
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn onClick={() => { setPersona(currentPersona); setOpen(true); }}>Edit persona</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit persona — ${name}`}>
        <div className="space-y-4">
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={12}
            className="w-full rounded border border-zinc-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <div className="flex items-center gap-3">
            <Btn variant="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Btn>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Feedback msg={feedback} />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Edit tools ───────────────────────────────────────────────────────────────

type EditToolsProps = { type: "edit-tools"; name: string; currentTools: string[]; allTools: string[] };

function EditTools({ name, currentTools, allTools }: { name: string; currentTools: string[]; allTools: string[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentTools);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const toggle = (t: string) =>
    setSelected((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const save = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("PATCH", { field: "allowedTools", name, allowedTools: selected });
      setFeedback("Saved");
      setTimeout(() => setOpen(false), 1000);
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn onClick={() => { setSelected(currentTools); setOpen(true); }}>Permissions</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`Tool permissions — ${name}`}>
        <div className="space-y-4">
          <p className="text-xs text-zinc-400">
            Tools marked <span className="text-amber-600 font-medium">!</span> can write data — grant deliberately.
          </p>
          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto">
            {allTools.map((t) => (
              <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(t)}
                  onChange={() => toggle(t)}
                  className="rounded"
                />
                <span className={WRITE_TOOL_SET.has(t) ? "text-amber-700 font-medium" : "text-zinc-700"}>
                  {t}{WRITE_TOOL_SET.has(t) ? " !" : ""}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Btn variant="primary" onClick={save} disabled={busy || selected.length === 0}>
              {busy ? "Saving…" : "Save"}
            </Btn>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Feedback msg={feedback} />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Toggle enabled ───────────────────────────────────────────────────────────

type ToggleProps = { type: "toggle"; name: string; enabled: boolean };

function ToggleEnabled({ name, enabled }: { name: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("PATCH", { field: "enabled", name, enabled: !enabled });
      setFeedback("Saved — reload to update");
      window.location.reload();
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <Btn onClick={toggle} disabled={busy}>
        {busy ? "Saving…" : enabled ? "Disable" : "Enable"}
      </Btn>
      <Feedback msg={feedback} />
    </div>
  );
}

// ─── Rename ───────────────────────────────────────────────────────────────────

type RenameProps = { type: "rename"; name: string };

function RenameAgent({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("PATCH", { field: "rename", name, newName });
      setFeedback("Renamed");
      setTimeout(() => { setOpen(false); window.location.reload(); }, 800);
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn onClick={() => { setNewName(name); setOpen(true); }}>Rename</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`Rename agent — ${name}`}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">New name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-3">
            <Btn variant="primary" onClick={save} disabled={busy || !newName || newName === name}>
              {busy ? "Renaming…" : "Rename"}
            </Btn>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Feedback msg={feedback} />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Delete ───────────────────────────────────────────────────────────────────

type DeleteProps = { type: "delete"; name: string };

function DeleteAgent({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const doDelete = async () => {
    setBusy(true); setFeedback(null);
    try {
      await apiFetch("DELETE", { name });
      setFeedback("Deleted");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setFeedback(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setConfirming(false);
    } finally { setBusy(false); }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Delete {name}?</span>
        <Btn variant="danger" onClick={doDelete} disabled={busy}>{busy ? "Deleting…" : "Confirm"}</Btn>
        <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
        <Feedback msg={feedback} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Btn variant="danger" onClick={() => setConfirming(true)}>Delete</Btn>
      <Feedback msg={feedback} />
    </div>
  );
}

// ─── Discriminated union export ───────────────────────────────────────────────

export type AgentActionsProps =
  | CreateProps
  | EditPersonaProps
  | EditToolsProps
  | ToggleProps
  | RenameProps
  | DeleteProps;

export function AgentActions(props: AgentActionsProps) {
  switch (props.type) {
    case "create":       return <CreateAgent allTools={props.allTools} />;
    case "edit-persona": return <EditPersona name={props.name} currentPersona={props.currentPersona} />;
    case "edit-tools":   return <EditTools name={props.name} currentTools={props.currentTools} allTools={props.allTools} />;
    case "toggle":       return <ToggleEnabled name={props.name} enabled={props.enabled} />;
    case "rename":       return <RenameAgent name={props.name} />;
    case "delete":       return <DeleteAgent name={props.name} />;
  }
}
