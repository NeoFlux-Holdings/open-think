import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "memory",
  title: "Memory",
  tagline: "Persistent agent memory — Cloudflare Agent Memory when bound, D1 fallback otherwise.",
  description: `Long-term memory for your agent. Five skills (\`memory-save\`, \`memory-recall\`, \`memory-list\`, \`memory-ingest\`, \`memory-forget\`) over a profile-scoped store. Routes to Cloudflare Agent Memory (private beta — \`env.MEMORY\` binding) when present; falls back to a D1 \`agent_memory\` table that Helm provisions on first write. The same plugin contract works on either backend, so flipping the managed binding on later requires no code change.`,
  type: "plugin",
  category: "memory",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/memory.ts",
  license: "Apache-2.0",
  tags: ["memory", "long-term", "agent-memory", "d1-fallback"],
  install: {
    enabledPluginsAdd: ["memory"],
    secrets: [],
    manualSteps: [
      "Either: bind Cloudflare Agent Memory (private beta) via [[memory]] in wrangler.toml — see https://blog.cloudflare.com/introducing-agent-memory/",
      "Or: bind a D1 database via [[d1_databases]] binding=\"DB\" — `wrangler d1 create tom-tom-pa` then paste database_id",
      "wrangler deploy"
    ]
  },
  docsPath: "/docs/pa-stack",
  verified: true,
  accents: ["#f38020", "#4a90e2"]
};
