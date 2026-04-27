import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "cloudflare-api-mcp",
  title: "Cloudflare API MCP",
  tagline: "Chat-first control plane for your entire Cloudflare account.",
  description: `The Cloudflare MCP server exposes every first-party Cloudflare product — zones, DNS, workers, R2, D1, KV, AI Gateway, Pages — as callable tools. With Open Think's \`cloudflare-api-mcp\` plugin pointed at it, Helm can provision infra, audit resources, and reason about your account in plain English. The rollback registry covers the destructive mutations so you can undo safely.`,
  type: "plugin",
  category: "account-ops",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/cloudflareApiMcp.ts",
  license: "Apache-2.0",
  tags: ["cloudflare", "mcp", "account-ops", "rollback-ready"],
  install: {
    enabledPluginsAdd: ["cloudflare-api-mcp"],
    allowedHostsAdd: ["api.cloudflare.com", "mcp.cloudflare.com"],
    secrets: [
      {
        name: "CLOUDFLARE_API_TOKEN",
        description: "Scoped token — we suggest Workers Scripts:Edit + D1:Edit + Zone:Edit at minimum.",
        required: true,
        pattern: "^[A-Za-z0-9_\\-]{20,}$"
      }
    ]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#f38020", "#fff"]
};
