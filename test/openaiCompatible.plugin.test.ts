import { describe, expect, it, vi } from "vitest";
import { OpenAICompatiblePlugin } from "../src/plugins/openaiCompatible";

function baseConfig() {
  return {
    enabledPlugins: new Set(["openai-compatible"]),
    allowedHosts: new Set(["api.groq.com"]),
    modelDefault: "llama-3.3-70b",
    alertErrorRatePct: 5
  };
}

describe("OpenAICompatiblePlugin", () => {
  it("requires baseUrl", async () => {
    const plugin = new OpenAICompatiblePlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "openai-compatible", ALLOWED_HOSTS: "api.groq.com" }
    });
    const result = await plugin.invoke("list-models", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAI_COMPATIBLE_URL/);
  });

  it("calls /chat/completions with bearer key", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url.endsWith("/chat/completions")).toBe(true);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gk-test");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new OpenAICompatiblePlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "openai-compatible",
        ALLOWED_HOSTS: "api.groq.com",
        OPENAI_COMPATIBLE_URL: "https://api.groq.com/openai/v1",
        OPENAI_COMPATIBLE_KEY: "gk-test"
      }
    });

    const result = await plugin.invoke("chat", {
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
  });
});
