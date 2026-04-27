import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "andrej-karpathy-skills",
  title: "Andrej Karpathy skills",
  tagline: "Curated skills library inspired by Karpathy's public workflows.",
  description: `A community-maintained collection of skill prompts modeled after Andrej Karpathy's public reasoning patterns — code review, debugging, literature-survey, paper-reading, teacher modes. Each skill is a structured prompt you can paste into Open Think's skill catalog or invoke ad-hoc via Helm.`,
  type: "skill-pack",
  category: "research",
  official: false,
  source: "https://github.com/forrestchang/andrej-karpathy-skills",
  author: "forrestchang",
  authorUrl: "https://github.com/forrestchang",
  license: "See repo",
  tags: ["skills", "prompts", "research", "karpathy", "coding"],
  install: {
    manualSteps: [
      "Clone the repo and inspect each skill file.",
      "For each skill you want, add a SkillDefinition to src/core/skills.ts with the prompt as the system message.",
      "Or run them transiently through Helm with a targeted system prompt override."
    ]
  },
  verified: false,
  accents: ["#4c6ef5"]
};
