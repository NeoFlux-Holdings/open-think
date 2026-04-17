import type { AgentRuntime } from "./runtime";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  pluginId: string;
  action: string;
  tags: string[];
}

export interface SkillInvocationRequest {
  input?: unknown;
}

const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "cf-introspect",
    name: "Cloudflare Introspect",
    description: "Check Cloudflare MCP plugin readiness and runtime metadata",
    pluginId: "cloudflare-api-mcp",
    action: "introspect",
    tags: ["cloudflare", "health", "mcp"]
  },
  {
    id: "cf-list-zones",
    name: "Cloudflare List Zones",
    description: "List Cloudflare zones (requires API/Agent token)",
    pluginId: "cloudflare-api-mcp",
    action: "list-zones",
    tags: ["cloudflare", "dns", "ops"]
  },
  {
    id: "cf-list-dns-records",
    name: "Cloudflare List DNS Records",
    description: "List DNS records for a zone (input.zoneId required)",
    pluginId: "cloudflare-api-mcp",
    action: "list-dns-records",
    tags: ["cloudflare", "dns", "records"]
  },
  {
    id: "artifacts-create-repo",
    name: "Artifacts Create Repo",
    description: "Create a Cloudflare Artifacts repository (input.name required)",
    pluginId: "artifacts",
    action: "create-repo",
    tags: ["artifacts", "git", "storage"]
  },
  {
    id: "artifacts-import-repo",
    name: "Artifacts Import Repo",
    description: "Import an existing repo into Artifacts (sourceUrl + targetName)",
    pluginId: "artifacts",
    action: "import-repo",
    tags: ["artifacts", "git", "import"]
  },
  {
    id: "artifacts-fork-repo",
    name: "Artifacts Fork Repo",
    description: "Fork an Artifacts repo (name + forkName)",
    pluginId: "artifacts",
    action: "fork-repo",
    tags: ["artifacts", "git", "fork"]
  },
  {
    id: "mpp-status",
    name: "MPP Status",
    description: "Check mpp provider connectivity and effective default model",
    pluginId: "mpp",
    action: "status",
    tags: ["mpp", "model", "provider"]
  },
  {
    id: "mpp-list-models",
    name: "MPP List Models",
    description: "List available models from mpp.dev",
    pluginId: "mpp",
    action: "list-models",
    tags: ["mpp", "models", "catalog"]
  }
];

export class SkillManager {
  constructor(private readonly runtime: AgentRuntime) {}

  listSkills(): SkillDefinition[] {
    const enabledPluginIds = new Set(this.runtime.listPlugins().map((plugin) => plugin.id));
    return SKILL_CATALOG.filter((skill) => enabledPluginIds.has(skill.pluginId));
  }

  getSkill(skillId: string): SkillDefinition | undefined {
    return this.listSkills().find((skill) => skill.id === skillId);
  }

  async invoke(skillId: string, request: SkillInvocationRequest) {
    const skill = this.getSkill(skillId);

    if (!skill) {
      return {
        ok: false,
        error: `Skill '${skillId}' is not available`,
        availableSkills: this.listSkills().map((s) => s.id)
      };
    }

    return this.runtime.invoke(skill.pluginId, {
      action: skill.action,
      input: request.input
    });
  }
}
