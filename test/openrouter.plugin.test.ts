import { describe, expect, it, vi } from "vitest";
import { OpenRouterPlugin } from "../src/plugins/openrouter";

function baseConfig() {
  return {
    enabledPlugins: new Set(["openrouter"]),
    allowedHosts: new Set(["openrouter.ai"]),
    modelDefault: "openrouter/auto",
    alertErrorRatePct: 5
  };
}

describe("OpenRouterPlugin", () => {
  it("status reports baseUrl + hasKey + default model", async () => {
    const plugin = new OpenRouterPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "openrouter",
        ALLOWED_HOSTS: "openrouter.ai",
        OPENROUTER_API_KEY: "sk-or-test"
      }
    });
    const result = await plugin.invoke("status", {});
    expect(result.ok).toBe(true);
    expect((result.data as { baseUrl: string }).baseUrl).toBe("https://openrouter.ai/api/v1");
    expect((result.data as { hasKey: boolean }).hasKey).toBe(true);
    expect((result.data as { modelDefault: string }).modelDefault).toBe("openrouter/auto");
  });

  it("rejects chat when OPENROUTER_API_KEY is missing", async () => {
    const plugin = new OpenRouterPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "openrouter", ALLOWED_HOSTS: "openrouter.ai" }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it("calls /chat/completions with bearer + attribution headers + auto model", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-or-test");
      expect(headers["X-Title"]).toBe("My App");
      expect(headers["HTTP-Referer"]).toBe("https://example.com");
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { model: string };
      expect(parsed.model).toBe("openrouter/auto");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new OpenRouterPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "openrouter",
        ALLOWED_HOSTS: "openrouter.ai",
        OPENROUTER_API_KEY: "sk-or-test",
        OPENROUTER_HTTP_REFERER: "https://example.com",
        OPENROUTER_X_TITLE: "My App"
      }
    });

    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects OPENROUTER_DEFAULT_MODEL override", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { model: string };
      expect(parsed.model).toBe("anthropic/claude-3.7-sonnet");
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const plugin = new OpenRouterPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "openrouter",
        ALLOWED_HOSTS: "openrouter.ai",
        OPENROUTER_API_KEY: "sk-or-test",
        OPENROUTER_DEFAULT_MODEL: "anthropic/claude-3.7-sonnet"
      }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
  });
});
