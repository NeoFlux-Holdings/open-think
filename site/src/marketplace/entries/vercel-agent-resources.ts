import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "vercel-agent-resources",
  title: "Vercel agent resources",
  tagline: "Vercel's common + finder skills, importable as prompts.",
  description: `Vercel's agent-resources catalog documents common capabilities and a "finder" pattern for discovering site content. Most entries are protocol-agnostic and translate to Open Think skill definitions with minor editing. Use the catalog as inspiration and a compatibility north-star.`,
  type: "skill-pack",
  category: "discovery",
  official: false,
  source: "https://vercel.com/docs/agent-resources/skills",
  author: "Vercel",
  authorUrl: "https://vercel.com",
  license: "See terms",
  tags: ["skills", "agent-resources", "vercel", "discovery", "reference"],
  install: {
    manualSteps: [
      "Open Vercel's skill catalog.",
      "For each common skill (summarize, compare, enumerate), write the equivalent Open Think SkillDefinition.",
      "For the finder pattern, expose a read-only tool over your sitemap/content and let Helm call it."
    ]
  },
  verified: false,
  accents: ["#000000"]
};
