import type { RuntimeConfig, SecretKey } from "./config";
import type { Env } from "../types";

export type PluginCapability =
  | "models"
  | "tools"
  | "mcp"
  | "connectors"
  | "cloudflare-api"
  | "artifacts"
  | "admin";

export interface PluginMetadata {
  id: string;
  version: string;
  description: string;
  capabilities: readonly PluginCapability[];
}

export interface RuntimeIntrospection {
  listPlugins(): PluginMetadata[];
  getConfigSnapshot(): {
    enabledPlugins: string[];
    allowedHosts: string[];
    modelDefault: string;
    alertErrorRatePct: number;
    hasCloudflareToken: boolean;
    hasAnthropicKey: boolean;
    hasOpenAICompatible: boolean;
    hasMcpDefault: boolean;
    hasAiGateway: boolean;
  };
}

export interface PluginContext {
  config: RuntimeConfig;
  fetch: typeof globalThis.fetch;
  env: Env;
  runtime?: RuntimeIntrospection;
}

export interface PluginResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentPlugin {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly PluginCapability[];
  readonly requiredSecrets?: readonly SecretKey[];

  initialize(context: PluginContext): Promise<void>;
  invoke(action: string, input: unknown): Promise<PluginResult>;
}
