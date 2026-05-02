import { parseConfig, type RuntimeConfig } from "./config";
import type { AgentPlugin, PluginCapability, RuntimeIntrospection } from "./plugin";
import type { Env, InvokeRequest } from "../types";
import { AppError } from "./errors";

const CAPABILITY_SET: Set<PluginCapability> = new Set([
  "models",
  "tools",
  "mcp",
  "connectors",
  "cloudflare-api",
  "artifacts",
  "admin"
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

    // Bundle/config tolerance: ENABLED_PLUGINS may list plugin ids that
    // exist in a newer runtime but not in the currently-deployed bundle
    // (e.g., the cloud-deploy form persists "helm-artifacts" in the var,
    // but the user's bundle is from before helm-artifacts shipped).
    // Filter unknown ids out with a warning instead of throwing — a
    // bundle/config skew shouldn't take the Worker offline.
    const unknownIds: string[] = [];
    for (const enabledId of config.enabledPlugins) {
      if (!allIds.has(enabledId)) {
        unknownIds.push(enabledId);
        config.enabledPlugins.delete(enabledId);
      }
    }
    if (unknownIds.length > 0) {
      console.warn(
        `[runtime] ignoring ${unknownIds.length} unknown plugin id${unknownIds.length === 1 ? "" : "s"} in ENABLED_PLUGINS: ${unknownIds.join(", ")} — bundle is older than the runtime config expects (run \`wrangler deploy\` from the latest source, or remove these from ENABLED_PLUGINS to silence)`
      );
    }

    const active = allPlugins.filter((plugin) => config.enabledPlugins.has(plugin.id));
    const restrictedFetch = createRestrictedFetch(config);

    const introspection: RuntimeIntrospection = {
      listPlugins: () =>
        active.map((p) => ({
          id: p.id,
          version: p.version,
          description: p.description,
          capabilities: p.capabilities
        })),
      getConfigSnapshot: () => ({
        enabledPlugins: Array.from(config.enabledPlugins),
        allowedHosts: Array.from(config.allowedHosts),
        modelDefault: config.modelDefault,
        alertErrorRatePct: config.alertErrorRatePct,
        hasCloudflareToken: Boolean(config.cloudflareApiToken ?? config.cloudflareAgentToken),
        hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
        hasOpenAICompatible: Boolean(env.OPENAI_COMPATIBLE_URL),
        hasMcpDefault: Boolean(env.MCP_DEFAULT_URL),
        hasAiGateway: Boolean(env.AI_GATEWAY_ID)
      })
    };

    for (const plugin of active) {
      requirePluginSecrets(plugin, config);
      await plugin.initialize({ config, fetch: restrictedFetch, env, runtime: introspection });
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
