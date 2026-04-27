import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "mcp-notion",
  title: "Notion MCP Server",
  tagline: "Pages, databases, and comments — agent-native.",
  description: `Notion's MCP surface covers page creation, database queries, block manipulation, and search. Useful for agents that draft docs, maintain a knowledge base, or keep a journal. Auth via Notion OAuth.`,
  type: "mcp-server",
  category: "productivity",
  official: false,
  source: "https://github.com/makenotion/notion-mcp-server",
  author: "Notion",
  authorUrl: "https://notion.so",
  license: "MIT",
  tags: ["mcp", "notion", "docs", "oauth"],
  install: {
    mcpUrl: "https://mcp.notion.com/mcp",
    mcpAuth: "oauth",
    enabledPluginsAdd: ["mcp-client"]
  },
  verified: false,
  accents: ["#000000"]
};
