import type { Env } from "../types";

export interface RuntimeConfig {
  enabledPlugins: Set<string>;
  allowedHosts: Set<string>;
  modelDefault: string;
  cloudflareApiToken?: string;
  cloudflareAgentToken?: string;
  mppApiKey?: string;
  alertWebhookUrl?: string;
  alertErrorRatePct: number;
}

export type SecretKey = "cloudflareApiToken" | "cloudflareAgentToken" | "mppApiKey";

const splitCsv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function parseConfig(env: Env): RuntimeConfig {
  const enabledPlugins = new Set(splitCsv(env.ENABLED_PLUGINS));
  const allowedHosts = new Set(splitCsv(env.ALLOWED_HOSTS));

  if (enabledPlugins.size === 0) {
    throw new Error("ENABLED_PLUGINS must include at least one plugin");
  }

  if (allowedHosts.size === 0) {
    throw new Error("ALLOWED_HOSTS must include at least one host");
  }

  const alertErrorRatePct = Number(env.ALERT_ERROR_RATE_PCT ?? "5");

  return {
    enabledPlugins,
    allowedHosts,
    modelDefault: env.MODEL_DEFAULT ?? "gpt-4.1-mini",
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
    cloudflareAgentToken: env.CLOUDFLARE_AGENT_TOKEN,
    mppApiKey: env.MPP_API_KEY,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL,
    alertErrorRatePct: Number.isFinite(alertErrorRatePct) ? alertErrorRatePct : 5
  };
}
