import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "codex",
  title: "Codex / ChatGPT subscription",
  tagline: "Use your ChatGPT Plus/Pro subscription instead of a separate API bill.",
  description: `Three auth paths — classic API key, paste-in tokens from \`codex login\`, or a full JSON-RPC bridge against \`codex app-server\`. The bridge path is the premium experience: tokens refresh automatically on the host, your Worker just forwards RPC. See the companion bridge recipe under \`companion/codex-bridge/\` for deployment options. Pair with \`codex-bridge-worker\` for a pure-Cloudflare flow where tokens live in a Durable Object and you rotate manually via \`POST /auth/rotate\`.`,
  type: "plugin",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/codex.ts",
  license: "Apache-2.0",
  tags: ["subscription", "codex", "bridge", "oauth-roadmap"],
  install: {
    enabledPluginsAdd: ["codex"],
    allowedHostsAdd: ["chatgpt.com", "api.openai.com"],
    secrets: [
      { name: "OPENAI_API_KEY", description: "Classic API key path. Billed at OpenAI API rates.", required: false },
      { name: "CODEX_ACCESS_TOKEN", description: "From ~/.codex/auth.json after `codex login`.", required: false },
      { name: "CODEX_ID_TOKEN", description: "Same source; paired with access token.", required: false },
      { name: "CODEX_APP_SERVER_URL", description: "URL of a running codex-bridge (ws:// or https://). Use the bridge worker's deployed URL.", required: false },
      { name: "CODEX_APP_SERVER_TOKEN", description: "Bearer token the main Worker sends to the bridge. Must match the bridge's BRIDGE_TOKEN secret.", required: false }
    ]
  },
  docsPath: "/docs/codex-appserver",
  verified: true,
  accents: ["#10a37f"]
};
