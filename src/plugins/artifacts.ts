import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

function parseStringField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const value = candidate[field];

  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  return value;
}

export class ArtifactsPlugin implements AgentPlugin {
  readonly id = "artifacts";
  readonly version = "0.1.0";
  readonly description = "Cloudflare Artifacts repository operations";
  readonly capabilities = ["artifacts", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.env.ARTIFACTS) {
      throw new Error("artifacts plugin requires ARTIFACTS binding in worker env");
    }

    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx?.env.ARTIFACTS) {
      return { ok: false, error: "Plugin not initialized" };
    }

    const artifacts = this.ctx.env.ARTIFACTS;

    if (action === "create-repo") {
      const name = parseStringField(input, "name");

      if (!name) {
        return { ok: false, error: "'name' is required for create-repo" };
      }

      const repo = await artifacts.create(name);
      return { ok: true, data: { remote: repo.remote, token: repo.token } };
    }

    if (action === "import-repo") {
      const sourceUrl = parseStringField(input, "sourceUrl");
      const targetName = parseStringField(input, "targetName");
      const branch = parseStringField(input, "branch") ?? "main";

      if (!sourceUrl || !targetName) {
        return { ok: false, error: "'sourceUrl' and 'targetName' are required for import-repo" };
      }

      const imported = await artifacts.import({
        source: { url: sourceUrl, branch },
        target: { name: targetName }
      });

      return { ok: true, data: imported };
    }

    if (action === "fork-repo") {
      const name = parseStringField(input, "name");
      const forkName = parseStringField(input, "forkName");

      if (!name || !forkName) {
        return { ok: false, error: "'name' and 'forkName' are required for fork-repo" };
      }

      const repo = await artifacts.get(name);
      const fork = await repo.fork(forkName, {
        readOnly: Boolean((input as Record<string, unknown>)?.readOnly)
      });

      return { ok: true, data: { remote: fork.remote, token: fork.token } };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
