import { describe, expect, it, vi } from "vitest";
import { McpClientPlugin } from "../src/plugins/mcpClient";

function config() {
  return {
    enabledPlugins: new Set(["mcp-client"]),
    allowedHosts: new Set(["mcp.cloudflare.com"]),
    modelDefault: "model-x",
    alertErrorRatePct: 5
  };
}

describe("McpClientPlugin", () => {
  it("fails list-tools when no serverUrl or default configured", async () => {
    const plugin = new McpClientPlugin();
    await plugin.initialize({
      config: config(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "mcp-client", ALLOWED_HOSTS: "mcp.cloudflare.com" }
    });

    const result = await plugin.invoke("list-tools", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/MCP_DEFAULT_URL/);
  });

  it("proxies list-tools to the configured server", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", result: { tools: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const plugin = new McpClientPlugin();
    await plugin.initialize({
      config: config(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "mcp-client",
        ALLOWED_HOSTS: "mcp.cloudflare.com",
        MCP_DEFAULT_URL: "https://mcp.cloudflare.com/mcp",
        MCP_BEARER_TOKEN: "demo"
      }
    });

    const result = await plugin.invoke("list-tools", {});
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer demo");
  });

  it("requires name for call-tool", async () => {
    const plugin = new McpClientPlugin();
    await plugin.initialize({
      config: config(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "mcp-client",
        ALLOWED_HOSTS: "mcp.cloudflare.com",
        MCP_DEFAULT_URL: "https://mcp.cloudflare.com/mcp"
      }
    });

    const result = await plugin.invoke("call-tool", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/);
  });
});
