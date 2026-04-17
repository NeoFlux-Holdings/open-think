import { describe, expect, it, vi } from "vitest";
import { CloudflareApiMcpPlugin } from "../src/plugins/cloudflareApiMcp";

describe("CloudflareApiMcpPlugin", () => {
  it("requires at least one cloudflare token", async () => {
    const plugin = new CloudflareApiMcpPlugin();

    await expect(
      plugin.initialize({
        config: {
          enabledPlugins: new Set(["cloudflare-api-mcp"]),
          allowedHosts: new Set(["api.cloudflare.com"]),
          modelDefault: "gpt-4.1-mini",
          alertErrorRatePct: 5
        },
        fetch,
        env: { ENABLED_PLUGINS: "", ALLOWED_HOSTS: "" }
      })
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN|CLOUDFLARE_AGENT_TOKEN/);
  });

  it("requires zoneId for list-dns-records", async () => {
    const plugin = new CloudflareApiMcpPlugin();

    await plugin.initialize({
      config: {
        enabledPlugins: new Set(["cloudflare-api-mcp"]),
        allowedHosts: new Set(["api.cloudflare.com"]),
        modelDefault: "gpt-4.1-mini",
        alertErrorRatePct: 5,
        cloudflareApiToken: "test-token"
      },
      fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))) as typeof globalThis.fetch,
      env: { ENABLED_PLUGINS: "", ALLOWED_HOSTS: "" }
    });

    const result = await plugin.invoke("list-dns-records", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/zoneId/);
  });
});
