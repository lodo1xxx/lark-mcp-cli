// agents.test.ts — unit tests for phase-05 multi-agent modules.
// Covers: agent-manifest, mcp-allowlist, agent-registry, binding-store, resolve-agent.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf-8");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const ddl = SCHEMA
    .split("\n")
    .filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);
  // Seed a project so agents FK resolves
  db.prepare("INSERT INTO projects (lark_app_id, name) VALUES (?, ?)").run("cli_test", "Test");
  return db;
}

function makeTmpAgentDir(name: string, manifest: object, includeClaudeMd = true): string {
  const dir = join(tmpdir(), `bridge-test-agents-${Date.now()}`, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.json"), JSON.stringify(manifest), "utf-8");
  if (includeClaudeMd) {
    writeFileSync(join(dir, "CLAUDE.md"), `# ${name} agent\nTest prompt.`, "utf-8");
  }
  return dir;
}

// ── agent-manifest tests ──────────────────────────────────────────────────────

describe("agent-manifest", () => {
  it("loads a valid manifest and returns typed Agent", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const dir = makeTmpAgentDir("myagent", {
      name: "myagent",
      model: "claude-sonnet-4-5",
      effort: null,
      allowedTools: ["lark_doc_search", "lark_doc_fetch"],
      enabled: true,
    });

    const agent = loadAgentManifest(dir);
    assert.equal(agent.name, "myagent");
    assert.equal(agent.model, "claude-sonnet-4-5");
    assert.equal(agent.effort, null);
    assert.deepEqual(agent.allowedTools, ["lark_doc_search", "lark_doc_fetch"]);
    assert.equal(agent.enabled, true);
    assert.ok(agent.folderPath.endsWith("myagent"));
    assert.ok(existsSync(agent.claudeMdPath));

    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  });

  it("throws when agent.json is missing", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const dir = join(tmpdir(), `bridge-noagentjson-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "# test", "utf-8");

    assert.throws(() => loadAgentManifest(dir), /Missing agent\.json/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when CLAUDE.md is missing", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const dir = join(tmpdir(), `bridge-noclaudemd-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "agent.json"), JSON.stringify({
      name: "x",
      model: "m",
      allowedTools: ["lark_doc_search"],
      enabled: true,
    }), "utf-8");

    assert.throws(() => loadAgentManifest(dir), /Missing CLAUDE\.md/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid tool names in allowedTools", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const dir = makeTmpAgentDir("badtools", {
      name: "badtools",
      model: "m",
      allowedTools: ["not_a_real_tool"],
      enabled: true,
    });

    assert.throws(() => loadAgentManifest(dir), /Invalid agent\.json/);
    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  });

  it("rejects manifest with invalid name pattern", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const dir = makeTmpAgentDir("badname", {
      name: "Bad Name With Spaces",
      model: "m",
      allowedTools: ["lark_doc_search"],
      enabled: true,
    });

    assert.throws(() => loadAgentManifest(dir), /Invalid agent\.json/);
    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  });
});

// ── mcp-allowlist tests ───────────────────────────────────────────────────────

describe("mcp-allowlist", () => {
  it("generates a valid mcp-config file and correct prefixed tool names", async () => {
    const { loadAgentManifest } = await import("../src/agents/agent-manifest.js");
    const { buildMcpAllowlist, toMcpToolName } = await import("../src/agents/mcp-allowlist.js");

    const dir = makeTmpAgentDir("allowlisttest", {
      name: "allowlisttest",
      model: "claude-sonnet-4-5",
      allowedTools: ["lark_doc_search", "lark_task_my"],
      enabled: true,
    });

    const agent = loadAgentManifest(dir);
    const result = buildMcpAllowlist(agent);

    // Config file should exist
    assert.ok(existsSync(result.mcpConfigPath), "mcp config file should exist");

    // Config content should be valid JSON with lark-cli server
    const config = JSON.parse(readFileSync(result.mcpConfigPath, "utf-8")) as {
      mcpServers: { "lark-cli": { command: string; args: string[] } };
    };
    assert.ok(config.mcpServers?.["lark-cli"]?.command, "should have lark-cli server command");
    assert.deepEqual(config.mcpServers["lark-cli"].args, ["mcp", "serve"]);

    // Allowed tool names should be prefixed
    assert.deepEqual(result.allowedToolNames, [
      "mcp__lark-cli__lark_doc_search",
      "mcp__lark-cli__lark_task_my",
    ]);

    // toMcpToolName helper
    assert.equal(toMcpToolName("lark_im_send"), "mcp__lark-cli__lark_im_send");

    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  });
});

// ── agent-registry tests ──────────────────────────────────────────────────────

describe("agent-registry", () => {
  // We test via the real bridge/agents/ folder (default + sales agents exist)
  it("reloadAgents scans bridge/agents/ and loads default + sales", async () => {
    const { reloadAgents, listAgents, getAgent, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();

    clearRegistry();
    reloadAgents(db);

    const agents = listAgents();
    const names = agents.map((r) => r.agent.name);

    assert.ok(names.includes("default"), `expected 'default' in ${JSON.stringify(names)}`);
    assert.ok(names.includes("sales"), `expected 'sales' in ${JSON.stringify(names)}`);

    db.close();
  });

  it("upserts agents into the DB agents table", async () => {
    const { reloadAgents, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();

    clearRegistry();
    reloadAgents(db);

    const rows = db.prepare("SELECT name FROM agents").all() as { name: string }[];
    const names = rows.map((r) => r.name);

    assert.ok(names.includes("default"));
    assert.ok(names.includes("sales"));

    db.close();
  });

  it("getAgent returns the registered agent by name", async () => {
    const { reloadAgents, getAgent, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();

    clearRegistry();
    reloadAgents(db);

    const reg = getAgent("default");
    assert.ok(reg, "should find 'default' agent");
    assert.equal(reg.agent.name, "default");
    assert.ok(reg.mcp.mcpConfigPath.endsWith("default.json"));
    assert.ok(reg.mcp.allowedToolNames.every((t) => t.startsWith("mcp__lark-cli__")));
    assert.ok(reg.dbId > 0);

    db.close();
  });

  it("skips folders with invalid manifests", async () => {
    const { reloadAgents, listAgents, clearRegistry } = await import("../src/agents/agent-registry.js");
    // Just verifies no crash — the real agents dir has valid agents
    const db = makeTestDb();

    clearRegistry();
    // Should not throw even if some folders are invalid
    assert.doesNotThrow(() => reloadAgents(db));

    db.close();
  });

  it("reloadAgents is idempotent — second call does not duplicate DB rows", async () => {
    const { reloadAgents, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();

    clearRegistry();
    reloadAgents(db);
    reloadAgents(db); // second call

    const rows = db.prepare("SELECT name, count(*) as cnt FROM agents GROUP BY name").all() as { name: string; cnt: number }[];
    for (const row of rows) {
      assert.equal(row.cnt, 1, `agent '${row.name}' should appear exactly once`);
    }

    db.close();
  });
});

// ── binding-store tests ───────────────────────────────────────────────────────

describe("binding-store", () => {
  it("getBinding returns undefined when no binding exists", async () => {
    const { getBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    const agentId = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'a', '/a')").run().lastInsertRowid);

    const result = getBinding(db, "oc_no_binding");
    assert.equal(result, undefined);

    db.close();
  });

  it("setBinding creates a new binding", async () => {
    const { getBinding, setBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    const agentId = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'b', '/b')").run().lastInsertRowid);

    setBinding(db, "oc_chat_1", agentId, 1);
    const binding = getBinding(db, "oc_chat_1");

    assert.ok(binding, "binding should exist");
    assert.equal(binding.agentId, agentId);
    assert.equal(binding.chatId, "oc_chat_1");
    assert.equal(binding.enabled, true);

    db.close();
  });

  it("setBinding updates existing binding", async () => {
    const { getBinding, setBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    const agentId1 = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'c1', '/c1')").run().lastInsertRowid);
    const agentId2 = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'c2', '/c2')").run().lastInsertRowid);

    setBinding(db, "oc_chat_update", agentId1, 1);
    setBinding(db, "oc_chat_update", agentId2, 1); // update

    const binding = getBinding(db, "oc_chat_update");
    assert.equal(binding?.agentId, agentId2);

    db.close();
  });

  it("disableBinding soft-deletes the binding", async () => {
    const { getBinding, setBinding, disableBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    const agentId = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'd', '/d')").run().lastInsertRowid);

    setBinding(db, "oc_chat_disable", agentId, 1);
    disableBinding(db, "oc_chat_disable", 1);

    const binding = getBinding(db, "oc_chat_disable");
    assert.equal(binding, undefined); // disabled = not returned

    db.close();
  });

  it("listBindings returns all enabled bindings", async () => {
    const { setBinding, listBindings } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    const agentId = Number(db.prepare("INSERT INTO agents (project_id, name, folder_path) VALUES (1, 'e', '/e')").run().lastInsertRowid);

    setBinding(db, "oc_list_1", agentId, 1);
    setBinding(db, "oc_list_2", agentId, 1);

    const all = listBindings(db);
    const chatIds = all.map((b) => b.chatId);
    assert.ok(chatIds.includes("oc_list_1"));
    assert.ok(chatIds.includes("oc_list_2"));

    const byProject = listBindings(db, 1);
    assert.ok(byProject.length >= 2);

    db.close();
  });
});

// ── resolve-agent tests ───────────────────────────────────────────────────────

describe("resolve-agent", () => {
  before(async () => {
    // Load the real agents so registry is populated
    const { reloadAgents, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();
    clearRegistry();
    reloadAgents(db);
    db.close();
  });

  it("unbound chat resolves to default agent", async () => {
    const { resolveAgent } = await import("../src/agents/resolve-agent.js");
    const { reloadAgents, clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();
    clearRegistry();
    reloadAgents(db);

    const resolved = resolveAgent(db, "oc_unbound_chat");
    assert.equal(resolved.agent.name, "default");
    assert.equal(resolved.source, "default");

    db.close();
  });

  it("bound chat resolves to its specific agent", async () => {
    const { resolveAgent } = await import("../src/agents/resolve-agent.js");
    const { reloadAgents, clearRegistry, getAgent } = await import("../src/agents/agent-registry.js");
    const { setBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    clearRegistry();
    reloadAgents(db);

    // Get the sales agent DB id
    const salesReg = getAgent("sales");
    assert.ok(salesReg, "sales agent should be in registry");
    setBinding(db, "oc_sales_chat", salesReg.dbId, 1);

    const resolved = resolveAgent(db, "oc_sales_chat");
    assert.equal(resolved.agent.name, "sales");
    assert.equal(resolved.source, "binding");

    db.close();
  });

  it("different chats resolve to different agents independently", async () => {
    const { resolveAgent } = await import("../src/agents/resolve-agent.js");
    const { reloadAgents, clearRegistry, getAgent } = await import("../src/agents/agent-registry.js");
    const { setBinding } = await import("../src/agents/binding-store.js");
    const db = makeTestDb();
    clearRegistry();
    reloadAgents(db);

    const salesReg = getAgent("sales");
    assert.ok(salesReg);
    setBinding(db, "oc_chat_sales", salesReg.dbId, 1);

    const resolvedSales = resolveAgent(db, "oc_chat_sales");
    const resolvedDefault = resolveAgent(db, "oc_chat_default_fallback");

    assert.equal(resolvedSales.agent.name, "sales");
    assert.equal(resolvedDefault.agent.name, "default");
    assert.notEqual(resolvedSales.agent.folderPath, resolvedDefault.agent.folderPath);

    db.close();
  });

  it("throws when registry is empty and no binding exists", async () => {
    const { resolveAgent } = await import("../src/agents/resolve-agent.js");
    const { clearRegistry } = await import("../src/agents/agent-registry.js");
    const db = makeTestDb();
    clearRegistry(); // wipe registry without loading

    assert.throws(
      () => resolveAgent(db, "oc_no_agent_chat"),
      /No agent resolved/,
    );

    db.close();
  });
});
