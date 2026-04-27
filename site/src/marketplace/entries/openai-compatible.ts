import type { MarketplaceEntry } from "../types";

export const entry: MarketplaceEntry = {
  slug: "openai-compatible",
  title: "OpenAI-compatible (direct)",
  tagline: "Groq, Together, Ollama, vLLM, or anything speaking the OpenAI schema.",
  description: `Point at any endpoint that implements OpenAI's \`/v1/chat/completions\` with \`tool_calls\`. Covers Groq's sub-second inference, Together's open-weight catalog, self-hosted Ollama on your LAN, and vLLM clusters. Our streaming adapter handles the incremental \`tool_calls\` chunk format.`,
  type: "plugin",
  category: "model-provider",
  official: true,
  source: "https://github.com/NeoFlux-Holdings/open-think/blob/main/src/plugins/openaiCompatible.ts",
  license: "Apache-2.0",
  tags: ["byok", "self-host-friendly", "tool-use", "streaming"],
  install: {
    enabledPluginsAdd: ["openai-compatible"],
    secrets: [
      {
        name: "OPENAI_COMPATIBLE_URL",
        description: "Base URL, e.g. https://api.groq.com/openai/v1",
        required: true
      },
      {
        name: "OPENAI_COMPATIBLE_KEY",
        description: "Bearer token for the endpoint. Optional for local Ollama.",
        required: false
      }
    ],
    manualSteps: ["Add the endpoint's hostname to ALLOWED_HOSTS before your first call."]
  },
  docsPath: "/docs/providers",
  verified: true,
  accents: ["#74aa9c"]
};
