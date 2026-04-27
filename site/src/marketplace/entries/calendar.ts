import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "calendar",
  title: "Calendar (MCP-delegated)",
  tagline: "Calendar via any MCP server — Google Calendar, CalDAV, custom.",
  description: `There's no native Cloudflare calendar service, so this plugin delegates to whichever calendar MCP server you point at via \`CALENDAR_MCP_URL\`. Two skills — \`calendar-today\` and \`calendar-upcoming\` — return forward-call descriptors that route through \`mcp-call-tool\`, preserving the same approve-to-run / rollback flow as any other MCP server. Recommended pairings: block/google-calendar-mcp-server (Google) or any CalDAV-bridge MCP. Honest about the indirection: if you don't already trust an MCP server, this won't help.`,
  type: "plugin",
  category: "productivity",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/calendar.ts",
  license: "Apache-2.0",
  tags: ["calendar", "mcp-delegated", "indirect", "google-calendar", "caldav"],
  install: {
    enabledPluginsAdd: ["calendar", "mcp-client"],
    secrets: [
      {
        name: "CALENDAR_MCP_URL",
        description: "Base URL of a calendar MCP server (must also be in ALLOWED_HOSTS).",
        required: true
      }
    ],
    manualSteps: [
      "Pick or deploy a calendar MCP server (Google Calendar, CalDAV, etc.)",
      "wrangler secret put CALENDAR_MCP_URL",
      "Add the server's hostname to ALLOWED_HOSTS in wrangler.toml",
      "wrangler deploy"
    ]
  },
  docsPath: "/docs/pa-stack",
  verified: true,
  accents: ["#4a90e2"]
};
