import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "codex-bridge-worker",
  title: "codex-bridge-worker",
  tagline: "Cloudflare-native bridge for your ChatGPT subscription — no Docker, but manual token rotation.",
  description: `A companion Worker (not a plugin) that proxies paste-in Codex tokens to the ChatGPT backend the \`codex\` CLI talks to. Uses a Durable Object for token storage and exposes /rpc + /stream for the main Worker's \`codex\` plugin. Pick this when you want to stay entirely on Cloudflare. **Caveat:** the bridge can't refresh tokens itself — you rotate them by running \`codex login\` locally and POSTing the new values to /auth/rotate. Full thread/turn/steer semantics still need the Node codex-bridge in companion/codex-bridge/.`,
  type: "companion",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/tree/main/companion/codex-bridge-worker",
  license: "Apache-2.0",
  tags: ["codex", "bridge", "companion", "cloudflare-native", "no-docker", "manual-rotation"],
  install: {
    repoUrl: "https://github.com/NeoFlux-Holdings/open-think/tree/main/companion/codex-bridge-worker",
    manualSteps: [
      "cd companion/codex-bridge-worker",
      "npm install",
      "wrangler secret put BRIDGE_TOKEN  ← long random string; set this BEFORE deploy so the DO migration picks it up",
      "npx wrangler deploy  ← creates the Worker + CodexAuthDO",
      "Run `codex login` locally, then grab accessToken + idToken from ~/.codex/auth.json",
      "curl -X POST https://<bridge-worker>/auth/rotate -H 'authorization: Bearer <BRIDGE_TOKEN>' -d '{\"accessToken\":\"...\",\"idToken\":\"...\"}'",
      "On the main Worker: set CODEX_APP_SERVER_URL=https://<bridge-worker> and CODEX_APP_SERVER_TOKEN=<BRIDGE_TOKEN>  (same value)",
      "Redeploy the main Worker and call /healthz on the bridge to confirm { configured: true }"
    ]
  },
  docsPath: "/docs/codex-appserver",
  verified: true,
  accents: ["#10a37f", "#f38020"]
};
