import { JsonHttpConnector } from "../core/connectors";
import type { RuntimeConfig } from "../core/config";
import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

function resolveCloudflareToken(config: RuntimeConfig): string | undefined {
  return config.cloudflareApiToken ?? config.cloudflareAgentToken;
}

function parseZoneId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.zoneId !== "string" || candidate.zoneId.trim() === "") {
    return undefined;
  }

  return candidate.zoneId;
}

export class CloudflareApiMcpPlugin implements AgentPlugin {
  readonly id = "cloudflare-api-mcp";
  readonly version = "0.4.0";
  readonly description = "Cloudflare API and MCP-oriented actions";
  readonly capabilities = ["cloudflare-api", "mcp", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!resolveCloudflareToken(context.config)) {
      throw new Error("cloudflare-api-mcp requires CLOUDFLARE_API_TOKEN or CLOUDFLARE_AGENT_TOKEN");
    }

    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    const token = resolveCloudflareToken(this.ctx.config);
    const cf = new JsonHttpConnector(this.ctx.fetch, {
      baseUrl: "https://api.cloudflare.com/client/v4",
      defaultHeaders: {
        Authorization: `Bearer ${token}`
      }
    });

    if (action === "introspect") {
      return {
        ok: true,
        data: {
          provider: "cloudflare",
          mode: "mcp-ready",
          receivedInput: input ?? null
        }
      };
    }

    if (action === "list-zones") {
      const response = await cf.get("/zones?per_page=5");

      if (!response.ok) {
        return {
          ok: false,
          error: `Cloudflare API error (${response.status})`
        };
      }

      return {
        ok: true,
        data: response.data
      };
    }

    if (action === "list-dns-records") {
      const zoneId = parseZoneId(input);

      if (!zoneId) {
        return {
          ok: false,
          error: "'zoneId' is required for list-dns-records"
        };
      }

      const response = await cf.get(`/zones/${zoneId}/dns_records?per_page=20`);

      if (!response.ok) {
        return {
          ok: false,
          error: `Cloudflare API error (${response.status})`
        };
      }

      return { ok: true, data: response.data };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
