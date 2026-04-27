import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "sandbox",
  title: "Cloudflare Sandbox",
  tagline: "Tier-4 execution — arbitrary shell commands in a sandbox.",
  description: `Binds a Cloudflare Sandbox service so Helm can run shell commands, compile code, or exercise binaries. Dangerous, selective-mode-gated, and scoped to whatever the sandbox image allows.`,
  type: "plugin",
  category: "code-exec",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/sandbox.ts",
  license: "Apache-2.0",
  tags: ["sandbox", "tier-4", "code-exec", "dangerous-by-default"],
  install: {
    enabledPluginsAdd: ["sandbox"],
    wranglerSnippet: `[[services]]\nbinding = "SANDBOX"\nservice = "my-sandbox-worker"`,
    secrets: []
  },
  docsPath: "/docs/capabilities",
  verified: true,
  accents: ["#f38020"]
};
