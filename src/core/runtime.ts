import { parseConfig, type RuntimeConfig } from "./config";
import type { AgentPlugin, PluginCapability } from "./plugin";
import type { Env, InvokeRequest } from "../types";
import { AppError } from "./errors";

const CAPABILITY_SET: Set<PluginCapability> = new Set([
  "models",
  "tools",
  "mcp",
  "connectors",
  "cloudflare-api",
  "artifacts"
]);

function createRestrictedFetch(config: RuntimeConfig): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const candidate =
      typeof input === "string" || input instanceof URL
        ? new URL(input)
        : new URL(input.url);

    if (!config.allowedHosts.has(candidate.hostname)) {
      throw new AppError(
        "E_HOST_NOT_ALLOWED",
        `Outbound host '${candidate.hostname}' is not in ALLOWED_HOSTS`,
        403
      );
    }

    return globalThis.fetch(input, init);
  };
}

function requirePluginSecrets(plugin: AgentPlugin, config: RuntimeConfig): void {
  const missing = (plugin.requiredSecrets ?? []).filter((secretKey) => !config[secretKey]);

  if (missing.length > 0) {
    throw new AppError(
      "E_PLUGIN_SECRET_MISSING",
      `Plugin '${plugin.id}' is missing required secrets: ${missing.join(", ")}`,
      500
    );
  }
}

function validatePluginRegistry(allPlugins: AgentPlugin[]): void {
  const ids = new Set<string>();

  for (const plugin of allPlugins) {
    if (ids.has(plugin.id)) {
      throw new AppError("E_PLUGIN_INVALID", `Duplicate plugin ID '${plugin.id}' in registry`, 500);
    }

    ids.add(plugin.id);

    if (plugin.capabilities.length === 0) {
      throw new AppError(
        "E_PLUGIN_INVALID",
        `Plugin '${plugin.id}' must declare at least one capability`,
        500
      );
    }

    for (const capability of plugin.capabilities) {
      if (!CAPABILITY_SET.has(capability)) {
        throw new AppError(
          "E_PLUGIN_INVALID",
          `Plugin '${plugin.id}' declares unknown capability '${capability}'`,
          500
        );
      }
    }
  }
}

export class AgentRuntime {
  readonly config: RuntimeConfig;
  private readonly plugins: Map<string, AgentPlugin>;

  private constructor(config: RuntimeConfig, plugins: AgentPlugin[]) {
    this.config = config;
    this.plugins = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  }

  static async bootstrap(env: Env, allPlugins: AgentPlugin[]): Promise<AgentRuntime> {
    validatePluginRegistry(allPlugins);

    const config = parseConfig(env);
    const allIds = new Set(allPlugins.map((plugin) => plugin.id));

    for (const enabledId of config.enabledPlugins) {
      if (!allIds.has(enabledId)) {
        throw new AppError("E_PLUGIN_UNKNOWN", `Enabled plugin '${enabledId}' is not registered`, 400);
      }
    }

    const active = allPlugins.filter((plugin) => config.enabledPlugins.has(plugin.id));
    const restrictedFetch = createRestrictedFetch(config);

    for (const plugin of active) {
      requirePluginSecrets(plugin, config);
      await plugin.initialize({ config, fetch: restrictedFetch, env });
    }

    return new AgentRuntime(config, active);
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      description: plugin.description,
      capabilities: plugin.capabilities
    }));
  }

  async invoke(pluginId: string, request: InvokeRequest) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return { ok: false, error: `Plugin '${pluginId}' is not enabled` };
    }

    return plugin.invoke(request.action, request.input);
  }
}
