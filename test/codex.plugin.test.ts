import { describe, expect, it, vi } from "vitest";
import { CodexPlugin } from "../src/plugins/codex";

function baseConfig() {
  return {
    enabledPlugins: new Set(["codex"]),
    allowedHosts: new Set(["api.openai.com", "chatgpt.com"]),
    modelDefault: "gpt-5-codex",
    alertErrorRatePct: 5
  };
}

describe("CodexPlugin", () => {
  it("status reports unconfigured when no secrets", async () => {
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "codex", ALLOWED_HOSTS: "api.openai.com" }
    });
    const result = await plugin.invoke("status", {});
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.authMode).toBe("unconfigured");
  });

  it("setup-instructions returns all four modes", async () => {
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "codex", ALLOWED_HOSTS: "api.openai.com" }
    });
    const result = await plugin.invoke("setup-instructions", {});
    expect(result.ok).toBe(true);
    const data = result.data as { modes: Array<{ id: string }> };
    expect(data.modes.map((m) => m.id)).toEqual([
      "api-key",
      "chatgpt-tokens",
      "app-server",
      "oauth-device"
    ]);
  });

  it("chat fails gracefully when unconfigured", async () => {
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "codex", ALLOWED_HOSTS: "api.openai.com" }
    });
    const result = await plugin.invoke("chat", { messages: [{ role: "user", content: "hi" }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unconfigured/);
  });

  it("api-key mode hits OpenAI chat completions", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "api.openai.com",
        OPENAI_API_KEY: "sk-test"
      }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { mode: string };
    expect(data.mode).toBe("api-key");
  });

  it("chatgpt-tokens mode sends Authorization + id token headers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer access-xyz");
      expect(headers["x-codex-id-token"]).toBe("id-xyz");
      return new Response(
        JSON.stringify({ id: "resp_1", output: [{ type: "text", text: "hi" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "chatgpt.com",
        CODEX_ACCESS_TOKEN: "access-xyz",
        CODEX_ID_TOKEN: "id-xyz"
      }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { mode: string };
    expect(data.mode).toBe("chatgpt-tokens");
  });

  it("app-server mode takes precedence over api-key and chatgpt-tokens", async () => {
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "api.openai.com",
        OPENAI_API_KEY: "sk-test",
        CODEX_ACCESS_TOKEN: "access",
        CODEX_APP_SERVER_URL: "https://codex.example.com"
      }
    });
    const result = await plugin.invoke("status", {});
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.authMode).toBe("app-server");
    expect(data.appServerTransport).toBe("http");
  });

  it("thread-start requires CODEX_APP_SERVER_URL", async () => {
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "api.openai.com",
        OPENAI_API_KEY: "sk-test"
      }
    });
    const result = await plugin.invoke("thread-start", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/CODEX_APP_SERVER_URL/);
  });

  it("app-server chat issues thread/start + turn/start JSON-RPC calls", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        method: string;
        id: string;
        params: Record<string, unknown>;
      };
      if (body.method === "thread/start") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { thread_id: "thr_1" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (body.method === "turn/start") {
        expect(body.params.thread_id).toBe("thr_1");
        expect(body.params.input).toBe("hi");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { turn_id: "trn_1", output: [{ type: "text", text: "hello" }] }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "codex.example.com",
        CODEX_APP_SERVER_URL: "https://codex.example.com/rpc",
        CODEX_APP_SERVER_TOKEN: "secret"
      }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(true);
    const data = result.data as { mode: string; threadId: string; turn: Record<string, unknown> };
    expect(data.mode).toBe("app-server");
    expect(data.threadId).toBe("thr_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authHeader = (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)?.Authorization;
    expect(authHeader).toBe("Bearer secret");
  });

  it("app-server rpc passthrough relays method + params", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { method: string; id: string };
      expect(body.method).toBe("skills/list");
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { skills: ["a", "b"] } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "codex.example.com",
        CODEX_APP_SERVER_URL: "https://codex.example.com/rpc"
      }
    });
    const result = await plugin.invoke("rpc", { method: "skills/list", params: {} });
    expect(result.ok).toBe(true);
    const data = result.data as { mode: string; result: { skills: string[] } };
    expect(data.result.skills).toEqual(["a", "b"]);
  });

  it("chatgpt-tokens mode surfaces token-refresh hint on 401", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("expired", { status: 401, headers: { "content-type": "text/plain" } })
    );
    const plugin = new CodexPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "codex",
        ALLOWED_HOSTS: "chatgpt.com",
        CODEX_ACCESS_TOKEN: "stale"
      }
    });
    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/codex login/);
  });
});
