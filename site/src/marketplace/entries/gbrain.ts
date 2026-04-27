import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "gbrain",
  title: "gbrain",
  tagline: "Garry Tan's personal-agent pattern — a brain for your assistant.",
  description: `gbrain captures a personal-agent pattern for building a Claude-powered "second brain" with memory, workflows, and recall. We list it here as a pattern library to adapt — the flows map onto Open Think skills and sessions, but the integration requires porting the prompts and memory layer. Read the repo first, then consider whether your goal is to fork-and-adapt or reference-and-extract.`,
  type: "skill-pack",
  category: "memory",
  official: false,
  source: "https://github.com/garrytan/gbrain",
  author: "Garry Tan",
  authorUrl: "https://github.com/garrytan",
  license: "See repo",
  tags: ["second-brain", "memory", "pattern", "reference"],
  install: {
    manualSteps: [
      "Read the gbrain README for the overall pattern.",
      "Map the memory layer to Open Think sessions (AgentSessionDO).",
      "Port individual prompts as entries in src/core/skills.ts, or run them through Helm ad-hoc."
    ]
  },
  verified: false,
  accents: ["#6b7280"]
};
