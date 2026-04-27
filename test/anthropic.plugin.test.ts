import { describe, expect, it, vi } from "vitest";
import { AnthropicPlugin } from "../src/plugins/anthropic";

function baseConfig() {
  return {
    enabledPlugins: new Set(["anthropic"]),
    allowedHosts: new Set(["api.anthropic.com"]),
    modelDefault: "claude-opus-4-7",
    alertErrorRatePct: 5
  };
}

describe("AnthropicPlugin", () => {
  it("requires ANTHROPIC_API_KEY", async () => {
    const plugin = new AnthropicPlugin();
    await expect(
      plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: { ENABLED_PLUGINS: "anthropic", ALLOWED_HOSTS: "api.anthropic.com" }
      })
    ).rejects.toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("calls /v1/messages with x-api-key header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    );
    const plugin = new AnthropicPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "anthropic",
        ALLOWED_HOSTS: "api.anthropic.com",
        ANTHROPIC_API_KEY: "sk-ant-test"
      }
    });

    const result = await plugin.invoke("chat", {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid role", async () => {
    const plugin = new AnthropicPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "anthropic",
        ALLOWED_HOSTS: "api.anthropic.com",
        ANTHROPIC_API_KEY: "sk-ant-test"
      }
    });

    const result = await plugin.invoke("chat", {
      messages: [{ role: "system", content: "bad" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/role/);
  });
});
