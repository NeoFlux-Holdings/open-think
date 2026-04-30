import { describe, expect, it } from "vitest";
import { HelmSetupPlugin } from "../src/plugins/helmSetup";

function fakeRuntime() {
  return {
    listPlugins: () => [{ id: "admin", version: "0.1.0", description: "x", capabilities: ["admin"] as const }],
    getConfigSnapshot: () => ({
      enabledPlugins: ["admin", "helm-setup"],
      allowedHosts: ["api.cloudflare.com"],
      modelDefault: "openrouter/auto",
      alertErrorRatePct: 5,
      hasCloudflareToken: true,
      hasAnthropicKey: false,
      hasOpenAICompatible: false,
      hasMcpDefault: false,
      hasAiGateway: false
    })
  };
}

function baseConfig() {
  return {
    enabledPlugins: new Set(["helm-setup"]),
    allowedHosts: new Set(["api.cloudflare.com"]),
    modelDefault: "openrouter/auto",
    alertErrorRatePct: 5
  };
}

describe("HelmSetupPlugin", () => {
  it("status returns the capability matrix", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: { ENABLED_PLUGINS: "admin,helm-setup", ALLOWED_HOSTS: "api.cloudflare.com" }
    });
    const r = await plugin.invoke("status", {});
    expect(r.ok).toBe(true);
    const data = r.data as { readinessScore: number; capabilities: Array<{ id: string }> };
    expect(typeof data.readinessScore).toBe("number");
    expect(data.capabilities.length).toBeGreaterThan(0);
  });

  it("docs with no topic lists available topics", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: { ENABLED_PLUGINS: "helm-setup", ALLOWED_HOSTS: "" }
    });
    const r = await plugin.invoke("docs", {});
    expect(r.ok).toBe(true);
    const data = r.data as { topics: string[] };
    expect(data.topics).toContain("setup");
    expect(data.topics).toContain("topology");
    expect(data.topics).toContain("bindings");
    expect(data.topics).toContain("secrets");
    expect(data.topics).toContain("shell");
    expect(data.topics).toContain("skills");
  });

  it("docs returns content for known topic", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: { ENABLED_PLUGINS: "helm-setup", ALLOWED_HOSTS: "" }
    });
    const r = await plugin.invoke("docs", { topic: "setup" });
    expect(r.ok).toBe(true);
    const data = r.data as { topic: string; content: string };
    expect(data.topic).toBe("setup");
    expect(data.content).toMatch(/helm-setup-auto/);
  });

  it("docs returns error for unknown topic", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: { ENABLED_PLUGINS: "helm-setup", ALLOWED_HOSTS: "" }
    });
    const r = await plugin.invoke("docs", { topic: "nonexistent" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Available:/);
  });

  it("secrets-status lists known slots without leaking values", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: {
        ENABLED_PLUGINS: "helm-setup",
        ALLOWED_HOSTS: "",
        // Simulate a configured secret — only the boolean shows up.
        OPENROUTER_API_KEY: "sk-or-supersecret-DO-NOT-LEAK"
      }
    });
    const r = await plugin.invoke("secrets-status", {});
    expect(r.ok).toBe(true);
    const data = r.data as { slots: Array<{ name: string; configured: boolean }> };
    expect(data.slots.length).toBeGreaterThan(5);
    // Verify the value is NOT present anywhere in the response.
    const json = JSON.stringify(data);
    expect(json).not.toContain("supersecret");
    // The OPENROUTER_API_KEY slot should be marked configured.
    const slot = data.slots.find((s) => s.name === "OPENROUTER_API_KEY");
    expect(slot?.configured).toBe(true);
  });

  it("auto rejects when CLOUDFLARE_API_TOKEN missing", async () => {
    const plugin = new HelmSetupPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      runtime: fakeRuntime(),
      env: { ENABLED_PLUGINS: "helm-setup", ALLOWED_HOSTS: "api.cloudflare.com" }
    });
    const r = await plugin.invoke("auto", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CLOUDFLARE_API_TOKEN/);
  });
});
