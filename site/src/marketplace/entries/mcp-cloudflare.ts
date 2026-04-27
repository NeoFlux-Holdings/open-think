import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "mcp-cloudflare",
  title: "Cloudflare MCP Server",
  tagline: "Every Cloudflare product as callable tools.",
  description: `Cloudflare's hosted MCP endpoint at \`mcp.cloudflare.com/mcp\`. Workers, Pages, DNS, Zones, KV, D1, R2, Hyperdrive, Queues, AI Gateway — all navigable from any MCP client. Authenticate via OAuth in your client, or a scoped API token. Our rollback registry covers the destructive mutations.`,
  type: "mcp-server",
  category: "account-ops",
  official: true,
  source: "https://github.com/cloudflare/mcp-server-cloudflare",
  author: "Cloudflare",
  authorUrl: "https://cloudflare.com",
  license: "BSD-3-Clause",
  tags: ["mcp", "cloudflare", "infrastructure", "rollback-ready"],
  install: {
    mcpUrl: "https://mcp.cloudflare.com/mcp",
    mcpAuth: "oauth",
    enabledPluginsAdd: ["mcp-client"],
    allowedHostsAdd: ["mcp.cloudflare.com"],
    secrets: [
      {
        name: "MCP_DEFAULT_URL",
        description: "Set to https://mcp.cloudflare.com/mcp",
        required: true
      }
    ]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#f38020"]
};
