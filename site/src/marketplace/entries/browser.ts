import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "browser",
  title: "Browser Rendering",
  tagline: "Tier-3 execution — web automation and scraping from your agent.",
  description: `Binds Cloudflare's Browser Rendering API so Helm can fetch, screenshot, and interact with pages. Marked dangerous-by-default so selective mode halts before every browse call.`,
  type: "plugin",
  category: "browser",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/browser.ts",
  license: "Apache-2.0",
  tags: ["browser", "tier-3", "web", "dangerous-by-default"],
  install: {
    enabledPluginsAdd: ["browser"],
    wranglerSnippet: `[browser]\nbinding = "BROWSER"`,
    secrets: []
  },
  docsPath: "/docs/capabilities",
  verified: true,
  accents: ["#f38020"]
};
