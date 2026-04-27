import { describe, expect, it } from "vitest";
import { AdminPlugin } from "../src/plugins/admin";
import type { RuntimeIntrospection } from "../src/core/plugin";

function makeRuntime(pluginIds: string[], overrides: Partial<ReturnType<RuntimeIntrospection["getConfigSnapshot"]>> = {}): RuntimeIntrospection {
  return {
    listPlugins: () =>
      pluginIds.map((id) => ({
        id,
        version: "1.0.0",
        description: id,
        capabilities: ["tools"]
      })),
    getConfigSnapshot: () => ({
      enabledPlugins: pluginIds,
      allowedHosts: ["api.cloudflare.com"],
      modelDefault: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      alertErrorRatePct: 5,
      hasCloudflareToken: false,
      hasAnthropicKey: false,
      hasOpenAICompatible: false,
      hasMcpDefault: false,
      hasAiGateway: false,
      ...overrides
    })
  };
}

function baseConfig() {
  return {
    enabledPlugins: new Set(["admin"]),
    allowedHosts: new Set(["api.cloudflare.com"]),
    modelDefault: "x",
    alertErrorRatePct: 5
  };
}

describe("AdminPlugin", () => {
  it("requires runtime introspection", async () => {
    const plugin = new AdminPlugin();
    await expect(
      plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "api.cloudflare.com" }
      })
    ).rejects.toThrowError(/runtime introspection/);
  });

  it("introspect returns plugins + config", async () => {
    const plugin = new AdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "api.cloudflare.com" },
      runtime: makeRuntime(["admin", "workers-ai"])
    });

    const result = await plugin.invoke("introspect", {});
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      data: {
        plugins: [{ id: "admin" }, { id: "workers-ai" }]
      }
    });
  });

  it("health-check flags missing secrets", async () => {
    const plugin = new AdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "api.cloudflare.com" },
      runtime: makeRuntime(["admin", "anthropic"], { hasAnthropicKey: false })
    });

    const result = await plugin.invoke("health-check", {});
    expect(result.ok).toBe(true);
    const data = (result.data as { issues: string[]; healthy: boolean });
    expect(data.healthy).toBe(false);
    expect(data.issues.join(" ")).toMatch(/anthropic/);
  });

  it("suggest-plugins matches a goal", async () => {
    const plugin = new AdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "api.cloudflare.com" },
      runtime: makeRuntime(["admin"])
    });

    const result = await plugin.invoke("suggest-plugins", { goal: "I want to chat with Claude directly" });
    expect(result.ok).toBe(true);
    const data = result.data as { suggestions: Array<{ suggest: string[] }> };
    expect(data.suggestions.some((s) => s.suggest.includes("anthropic"))).toBe(true);
  });
});
