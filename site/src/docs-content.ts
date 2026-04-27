/**
 * Bundles repo markdown into the Worker at build time via the `[[rules]] type = "Text"`
 * loader in wrangler.toml. The repo's `docs/` folder is the source of truth — changes
 * ship with the next `wrangler deploy`. No duplicate content, no runtime fetch, no
 * GitHub rate limits.
 */

import architecture from "../../docs/ARCHITECTURE.md";
import paStack from "../../docs/PA_STACK.md";
import helm from "../../docs/HELM.md";
import providers from "../../docs/PROVIDERS.md";
import codexAppserver from "../../docs/CODEX_APPSERVER.md";
import rollback from "../../docs/ROLLBACK.md";
import setup from "../../docs/SETUP.md";
import thinkAlignment from "../../docs/THINK_ALIGNMENT.md";
import capabilities from "../../docs/CAPABILITIES.md";
import pluginSdk from "../../docs/PLUGIN_SDK.md";
import agentDeployPrompt from "../../docs/AGENT_DEPLOY_PROMPT.md";
import deployment from "../../docs/DEPLOYMENT_RUNBOOK.md";
import helmCloudRunbook from "../../docs/HELM_CLOUD_RUNBOOK.md";
import incident from "../../docs/INCIDENT_PLAYBOOK.md";
import release from "../../docs/RELEASE_POLICY.md";
import artifacts from "../../docs/ARTIFACTS_INTEGRATION.md";
import codexWeb from "../../docs/CODEX_WEB_SETUP.md";
import executionPlan from "../../docs/EXECUTION_PLAN.md";

export interface DocEntry {
  slug: string;
  title: string;
  blurb: string;
  body: string;
  section: "core" | "providers" | "runbooks" | "process";
  order: number;
}

export const DOC_ENTRIES: DocEntry[] = [
  {
    slug: "architecture",
    title: "Architecture",
    blurb:
      "How the three Workers, plugin bus, skill catalog, PA stack, and Helm Cloud SaaS layer fit together.",
    body: architecture,
    section: "core",
    order: 0
  },
  {
    slug: "pa-stack",
    title: "Personal-assistant stack",
    blurb:
      "Nine features (auth, memory, email, push, scheduler, workflows, cost, briefing, bridge hardening) on native Cloudflare primitives.",
    body: paStack,
    section: "core",
    order: 0.5
  },
  {
    slug: "helm",
    title: "Helm",
    blurb:
      "Meta-agent that reads your runtime and plans skill invocations. Three modes, native tool-use, streaming.",
    body: helm,
    section: "core",
    order: 1
  },
  {
    slug: "providers",
    title: "Providers",
    blurb:
      "Five paths to a model: Cloudflare AI Gateway, Workers AI, Anthropic, OpenAI-compatible, Codex.",
    body: providers,
    section: "providers",
    order: 2
  },
  {
    slug: "codex-appserver",
    title: "Codex app-server bridge",
    blurb:
      "Deployment recipes for using your ChatGPT Plus/Pro subscription with Open Think.",
    body: codexAppserver,
    section: "providers",
    order: 3
  },
  {
    slug: "rollback",
    title: "Rollback",
    blurb:
      "Undo destructive Cloudflare MCP operations via the shipped inverse registry (create/delete + update-style).",
    body: rollback,
    section: "core",
    order: 4
  },
  {
    slug: "setup",
    title: "Setup panel",
    blurb:
      "Runtime readiness score + snippet generator + guided setup that hands the work to Helm.",
    body: setup,
    section: "core",
    order: 5
  },
  {
    slug: "think-alignment",
    title: "Project Think alignment",
    blurb:
      "Mapping between Cloudflare Project Think primitives and Open Think's implementation.",
    body: thinkAlignment,
    section: "core",
    order: 6
  },
  {
    slug: "capabilities",
    title: "Capabilities",
    blurb: "Plugin capability contract + first-party plugin inventory.",
    body: capabilities,
    section: "core",
    order: 7
  },
  {
    slug: "plugin-sdk",
    title: "Plugin SDK",
    blurb: "Write your own plugin in 50 lines. Action router, secrets, restricted fetch.",
    body: pluginSdk,
    section: "core",
    order: 8
  },
  {
    slug: "deployment",
    title: "Deployment runbook",
    blurb: "From `wrangler login` to a live /health check.",
    body: deployment,
    section: "runbooks",
    order: 9
  },
  {
    slug: "helm-cloud-runbook",
    title: "Helm Cloud runbook",
    blurb:
      "Operator manual for the SaaS layer — secrets, deployments, cron health, incident response, and the pre-flight before flipping the public switch.",
    body: helmCloudRunbook,
    section: "runbooks",
    order: 9.5
  },
  {
    slug: "agent-deploy-prompt",
    title: "Agent-driven deploy prompt",
    blurb:
      "Self-contained prompt for Cloudflare Agent Lee, Claude, or ChatGPT to walk a user through deploying Open Think — surfaced live at /deploy/agent.",
    body: agentDeployPrompt,
    section: "runbooks",
    order: 9.7
  },
  {
    slug: "incident",
    title: "Incident playbook",
    blurb: "Triage, rollback, comms — the template we use ourselves.",
    body: incident,
    section: "runbooks",
    order: 10
  },
  {
    slug: "release",
    title: "Release policy",
    blurb: "Versioning, changelog discipline, release checklist.",
    body: release,
    section: "process",
    order: 11
  },
  {
    slug: "artifacts",
    title: "Artifacts integration",
    blurb: "How the artifacts plugin connects to Cloudflare Artifacts repos.",
    body: artifacts,
    section: "providers",
    order: 12
  },
  {
    slug: "codex-web",
    title: "Codex web setup",
    blurb: "Setup notes for the web-based Codex flow.",
    body: codexWeb,
    section: "providers",
    order: 13
  },
  {
    slug: "execution-plan",
    title: "Execution plan",
    blurb: "Phase-by-phase roadmap of everything shipped and queued.",
    body: executionPlan,
    section: "process",
    order: 14
  }
];

export function getDocBySlug(slug: string): DocEntry | undefined {
  return DOC_ENTRIES.find((d) => d.slug === slug);
}

export function getAdjacentDocs(slug: string): {
  prev: DocEntry | null;
  next: DocEntry | null;
} {
  const sorted = [...DOC_ENTRIES].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((d) => d.slug === slug);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? sorted[idx - 1] : null,
    next: idx < sorted.length - 1 ? sorted[idx + 1] : null
  };
}

export const SECTIONS: Array<{ id: DocEntry["section"]; label: string }> = [
  { id: "core", label: "Core" },
  { id: "providers", label: "Providers" },
  { id: "runbooks", label: "Runbooks" },
  { id: "process", label: "Process" }
];
