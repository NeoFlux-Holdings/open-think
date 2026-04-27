import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "cf-ai-gateway",
  title: "Cloudflare AI Gateway",
  tagline: "Many providers behind one plugin with BYOK via Secrets Store.",
  description: `One plugin, many providers — Anthropic, OpenAI, Google, Groq, Cerebras, Mistral, xAI, and more through Cloudflare's AI Gateway. Model ids take the form \`provider/model-name\` (e.g. \`anthropic/claude-opus-4-6\`), and keys live in Cloudflare's Secrets Store instead of your Worker config. Every call is cached, logged, and metered through the same AI Gateway that powers the rest of Cloudflare's platform.`,
  type: "plugin",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/cfAiGateway.ts",
  license: "Apache-2.0",
  tags: ["byok", "multi-provider", "streaming", "tool-use"],
  install: {
    enabledPluginsAdd: ["cf-ai-gateway"],
    allowedHostsAdd: ["gateway.ai.cloudflare.com"],
    secrets: [
      { name: "AI_GATEWAY_ID", description: "Gateway name you created in the dashboard.", required: true },
      { name: "CLOUDFLARE_ACCOUNT_ID", description: "Needed by the compat fallback path.", required: true }
    ],
    manualSteps: [
      "dash → AI → AI Gateway → Create gateway",
      "Store each provider key under the gateway's Provider Keys tab",
      "wrangler secret put AI_GATEWAY_ID"
    ]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#f38020"]
};
