import type { RuntimeConfig, SecretKey } from "./config";
import type { Env } from "../types";

export type PluginCapability =
  | "models"
  | "tools"
  | "mcp"
  | "connectors"
  | "cloudflare-api"
  | "artifacts";

export interface PluginContext {
  config: RuntimeConfig;
  fetch: typeof globalThis.fetch;
  env: Env;
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
  readonly capabilities: PluginCapability[];
  readonly requiredSecrets?: SecretKey[];

  initialize(context: PluginContext): Promise<void>;
  invoke(action: string, input: unknown): Promise<PluginResult>;
}
