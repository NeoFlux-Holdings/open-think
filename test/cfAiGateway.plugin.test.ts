import { describe, expect, it, vi } from "vitest";
import { CfAiGatewayPlugin } from "../src/plugins/cfAiGateway";

function baseConfig() {
  return {
    enabledPlugins: new Set(["cf-ai-gateway"]),
    allowedHosts: new Set(["gateway.ai.cloudflare.com", "api.anthropic.com", "api.openai.com"]),
    modelDefault: "anthropic/claude-haiku-4-5",
    alertErrorRatePct: 5
  };
}

describe("CfAiGatewayPlugin", () => {
  it("initializes without AI_GATEWAY_ID (soft init) but invocations fail with E_CF_GATEWAY_CONFIG", async () => {
    // Previously throwing at init was a hard fail that bricked the
    // runtime when ENABLED_PLUGINS listed cf-ai-gateway without the
    // matching env var. The deploy form's bundle/config skew tolerance
    // depends on init being soft — broken plugins should fail loudly
    // at INVOKE time, not at startup.
    const plugin = new CfAiGatewayPlugin();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com"
      }
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI_GATEWAY_ID not set")
    );
    warnSpy.mockRestore();
    // First chat invocation must fail. The exact error depends on
    // which env check fires first (compat URL needs both CLOUDFLARE_ACCOUNT_ID
    // and AI_GATEWAY_ID; the plugin checks CLOUDFLARE_ACCOUNT_ID first).
    // Either is acceptable — both surface as 400 E_CF_GATEWAY_CONFIG-shaped
    // errors with actionable copy.
    const r = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok).toBe(false);
    expect((r.error ?? "")).toMatch(/AI_GATEWAY_ID|CLOUDFLARE_ACCOUNT_ID|E_CF_GATEWAY_CONFIG/i);
  });

  it("status reports binding + account presence", async () => {
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "my-gateway",
        CLOUDFLARE_ACCOUNT_ID: "acct-123",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("status", {});
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.gatewayId).toBe("my-gateway");
    expect(data.hasBinding).toBe(true);
    expect(data.hasAccountId).toBe(true);
    expect(Array.isArray(data.supportedProviders)).toBe(true);
  });

  it("list-providers returns the catalog", async () => {
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "g",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("list-providers", {});
    expect(result.ok).toBe(true);
    const data = result.data as { providers: string[] };
    expect(data.providers).toContain("anthropic");
    expect(data.providers).toContain("openai");
    expect(data.providers).toContain("groq");
  });

  it("rejects chat without provider/model format", async () => {
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "g",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("chat", {
      model: "bad-model-name",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/provider\/model-name/);
  });

  it("routes via env.AI.run when binding present", async () => {
    const run = vi.fn(
      async (
        _model: string,
        _input: Record<string, unknown>,
        _opts?: Record<string, unknown>
      ) => ({ response: "hi" })
    );
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "g",
        AI: { run } as unknown as Ai
      }
    });
    const result = await plugin.invoke("chat", {
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { path: string; model: string };
    expect(data.path).toBe("binding");
    expect(data.model).toBe("anthropic/claude-haiku-4-5");
    expect(run).toHaveBeenCalledOnce();
    const callArgs = run.mock.calls[0];
    expect(callArgs[0]).toBe("anthropic/claude-haiku-4-5");
    expect(callArgs[2]).toMatchObject({ gateway: { id: "g" } });
  });

  it("chat-with-fallbacks returns the first success and records attempts", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: "overloaded" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "hi from model B" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "g",
        CLOUDFLARE_ACCOUNT_ID: "acct-123",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("chat-with-fallbacks", {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5"],
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { winner: { model: string; index: number }; attempts: Array<{ ok: boolean }> };
    expect(data.winner.model).toBe("openai/gpt-5");
    expect(data.winner.index).toBe(1);
    expect(data.attempts).toHaveLength(2);
    expect(data.attempts[0].ok).toBe(false);
    expect(data.attempts[1].ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("chat-with-fallbacks reports exhaustion when every model fails", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "down" }), { status: 503 })
    );
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "g",
        CLOUDFLARE_ACCOUNT_ID: "acct-123",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("chat-with-fallbacks", {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5"],
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fallback models failed/);
  });

  it("forceCompat falls back to REST path", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["cf-aig-authorization"]).toBe("ANTHROPIC_KEY_1");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CfAiGatewayPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cf-ai-gateway",
        ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
        AI_GATEWAY_ID: "my-g",
        CLOUDFLARE_ACCOUNT_ID: "acct-123",
        AI: { run: async () => ({}) } as unknown as Ai
      }
    });
    const result = await plugin.invoke("chat", {
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
      forceCompat: true,
      providerKeyRef: "ANTHROPIC_KEY_1"
    });
    expect(result.ok).toBe(true);
    const data = result.data as { path: string };
    expect(data.path).toBe("compat");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
