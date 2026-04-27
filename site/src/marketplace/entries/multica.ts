import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "multica",
  title: "Multica",
  tagline: "Multi-agent orchestration — compose agents, not just prompts.",
  description: `Multica explores multi-agent patterns where a coordinator agent delegates to specialist agents over structured protocols. Listed here as an inspiration for Open Think's future "facets" / sub-agents work. Today, the practical integration is to use Multica's patterns inside Helm's propose → approve loop, with each specialist backed by a separate session.`,
  type: "agent-template",
  category: "orchestration",
  official: false,
  source: "https://github.com/multica-ai/multica",
  author: "Multica",
  authorUrl: "https://github.com/multica-ai",
  license: "See repo",
  tags: ["multi-agent", "orchestration", "pattern", "roadmap-relevant"],
  install: {
    manualSteps: [
      "Read Multica's orchestration pattern docs.",
      "Map coordinator/specialist roles to Open Think sessions — one session per agent identity.",
      "Wire cross-session messaging via session fork + fiber handoffs (see docs/THINK_ALIGNMENT.md)."
    ]
  },
  docsPath: "/docs/think-alignment",
  verified: false,
  accents: ["#a855f7"]
};
