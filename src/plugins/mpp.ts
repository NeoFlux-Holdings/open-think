import { JsonHttpConnector } from "../core/connectors";
import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

export class MppPlugin implements AgentPlugin {
  readonly id = "mpp";
  readonly version = "0.3.0";
  readonly description = "mpp.dev model/provider integration";
  readonly capabilities = ["models", "connectors"] as const;
  readonly requiredSecrets = ["mppApiKey"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    const mpp = new JsonHttpConnector(this.ctx.fetch, {
      baseUrl: "https://api.mpp.dev",
      defaultHeaders: {
        Authorization: `Bearer ${this.ctx.config.mppApiKey}`
      }
    });

    if (action === "status") {
      return {
        ok: true,
        data: {
          provider: "mpp.dev",
          modelDefault: this.ctx.config.modelDefault,
          inputPreview: input ?? null
        }
      };
    }

    if (action === "list-models") {
      const response = await mpp.get("/v1/models");

      if (!response.ok) {
        return {
          ok: false,
          error: `mpp API error (${response.status})`
        };
      }

      return {
        ok: true,
        data: response.data
      };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
