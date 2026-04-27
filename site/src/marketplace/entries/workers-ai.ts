import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "workers-ai",
  title: "Workers AI (direct)",
  tagline: "Cloudflare-hosted models on the free tier, zero secrets.",
  description: `Direct \`env.AI\` binding — no gateway, no intermediate account. Perfect first step while you evaluate Open Think: Llama 3.3, Mistral, and the full Workers AI catalog answer out of the box on every deploy. Pair with \`cf-ai-gateway\` later when you need BYOK.`,
  type: "plugin",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/workersAi.ts",
  license: "Apache-2.0",
  tags: ["free-tier", "no-secret", "default"],
  install: {
    enabledPluginsAdd: ["workers-ai"],
    wranglerSnippet: `[ai]\nbinding = "AI"`,
    secrets: []
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#f38020"]
};
