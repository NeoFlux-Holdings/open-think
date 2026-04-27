import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "mcp-github",
  title: "GitHub MCP Server",
  tagline: "Issues, PRs, files, and searches from your agent.",
  description: `GitHub's official MCP server. Read/write repos, manage issues and PRs, search code, and traverse org state via structured tools. Auth via OAuth or a personal access token. Pair with your project's runtime to ship code changes conversationally.`,
  type: "mcp-server",
  category: "productivity",
  official: false,
  source: "https://github.com/github/github-mcp-server",
  author: "GitHub",
  authorUrl: "https://github.com",
  license: "MIT",
  tags: ["mcp", "github", "code", "issues", "oauth"],
  install: {
    mcpUrl: "https://api.githubcopilot.com/mcp",
    mcpAuth: "oauth",
    enabledPluginsAdd: ["mcp-client"],
    allowedHostsAdd: ["api.githubcopilot.com"]
  },
  verified: false,
  accents: ["#24292f"]
};
