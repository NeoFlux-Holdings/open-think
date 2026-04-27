import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "mcp-client",
  title: "MCP Client",
  tagline: "Connect to any MCP server — Cloudflare, Notion, Linear, or custom.",
  description: `Outbound MCP over streamable-HTTP and Server-Sent Events. Pair with any MCP server URL you trust; Helm will expose the server's tools as skills automatically. Supports OAuth (via your MCP client) or static bearer auth.`,
  type: "plugin",
  category: "tools",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/mcpClient.ts",
  license: "Apache-2.0",
  tags: ["mcp", "client", "universal", "rollback-ready"],
  install: {
    enabledPluginsAdd: ["mcp-client"],
    secrets: [
      { name: "MCP_DEFAULT_URL", description: "Default MCP server URL (e.g. mcp.cloudflare.com/mcp).", required: false },
      { name: "MCP_BEARER_TOKEN", description: "Static bearer token (or leave empty for OAuth flows).", required: false }
    ]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#4a90e2"]
};
