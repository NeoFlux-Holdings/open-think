import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "anthropic",
  title: "Anthropic (direct)",
  tagline: "Claude Messages API with native tool-use streaming.",
  description: `Direct to \`api.anthropic.com\` with full tool_use block support. When Helm runs in auto mode, this path gives you the cleanest streaming experience because the Anthropic SSE protocol is the adapter we support natively. Swap with \`cf-ai-gateway\` if you prefer BYOK through Cloudflare.`,
  type: "plugin",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/anthropic.ts",
  author: "Open Think",
  license: "Apache-2.0",
  tags: ["claude", "tool-use", "streaming", "direct"],
  install: {
    enabledPluginsAdd: ["anthropic"],
    allowedHostsAdd: ["api.anthropic.com"],
    secrets: [
      {
        name: "ANTHROPIC_API_KEY",
        description: "console.anthropic.com/settings/keys",
        required: true,
        pattern: "^sk-ant-"
      }
    ]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#d4a574"]
};
