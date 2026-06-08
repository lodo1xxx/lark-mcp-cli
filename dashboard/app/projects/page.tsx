// Projects page — list projects → agents → chat_bindings.
// Actions: rebind chat to different agent, toggle agent enabled.
// Server component; interactive actions use client island ProjectActions.

import { getProjectsWithAgents } from "@/lib/queries";
import { ProjectActions } from "@/components/project-actions";

export default function ProjectsPage() {
  const projects = getProjectsWithAgents();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Projects</h1>

      {projects.length === 0 && (
        <p className="text-zinc-500">No projects found. Seed the database or start the bridge.</p>
      )}

      {projects.map((project) => (
        <section key={project.id} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <span className="font-mono text-xs text-zinc-400">{project.lark_app_id}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                project.status === "active"
                  ? "bg-green-50 text-green-700"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {project.status}
            </span>
          </div>

          {project.agents.length === 0 && (
            <p className="text-sm text-zinc-400">No agents configured.</p>
          )}

          {project.agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{agent.name}</span>
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                    {agent.model}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      agent.enabled
                        ? "bg-blue-50 text-blue-700"
                        : "bg-zinc-100 text-zinc-400"
                    }`}
                  >
                    {agent.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <ProjectActions
                  type="toggle-agent"
                  agentId={agent.id}
                  enabled={agent.enabled === 1}
                />
              </div>

              {agent.bindings.length > 0 && (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-400">
                      <th className="pb-2 font-medium">Chat ID</th>
                      <th className="pb-2 font-medium">Binding</th>
                      <th className="pb-2 font-medium">Rebind</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {agent.bindings.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2 font-mono text-xs text-zinc-600">{b.chat_id}</td>
                        <td className="py-2 text-xs text-zinc-500">
                          {b.enabled ? "active" : "disabled"}
                        </td>
                        <td className="py-2">
                          <ProjectActions
                            type="rebind"
                            projectId={project.id}
                            chatId={b.chat_id}
                            currentAgentId={b.agent_id}
                            projectAgents={project.agents.map((a) => ({
                              id: a.id,
                              name: a.name,
                            }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
