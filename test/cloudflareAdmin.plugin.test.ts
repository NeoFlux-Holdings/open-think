import { describe, expect, it, vi } from "vitest";
import { CloudflareAdminPlugin } from "../src/plugins/cloudflareAdmin";

function baseConfig() {
  return {
    enabledPlugins: new Set(["cloudflare-admin"]),
    allowedHosts: new Set(["api.cloudflare.com"]),
    modelDefault: "openrouter/auto",
    alertErrorRatePct: 5
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("CloudflareAdminPlugin", () => {
  it("verify rejects when token missing", async () => {
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "cloudflare-admin", ALLOWED_HOSTS: "api.cloudflare.com" }
    });
    const r = await plugin.invoke("verify", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  it("verify calls /user/tokens/verify with bearer token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toBe("https://api.cloudflare.com/client/v4/user/tokens/verify");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer cf-test-token");
      return jsonResponse({
        success: true,
        result: { id: "tok-123", status: "active" }
      });
    });
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "cf-test-token"
      }
    });
    const r = await plugin.invoke("verify", {});
    expect(r.ok).toBe(true);
    expect((r.data as { id: string }).id).toBe("tok-123");
  });

  it("requires accountId for list-d1 if no env CLOUDFLARE_ACCOUNT_ID", async () => {
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "cf-test-token"
      }
    });
    const r = await plugin.invoke("list-d1", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/accountId required/);
  });

  it("create-d1 POSTs to the right path with name body", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/d1/database");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({ name: "helm-pa" });
      return jsonResponse({ success: true, result: { uuid: "u-1", name: "helm-pa" } });
    });
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "t",
        CLOUDFLARE_ACCOUNT_ID: "acc-1"
      }
    });
    const r = await plugin.invoke("create-d1", { name: "helm-pa" });
    expect(r.ok).toBe(true);
    expect((r.data as { uuid: string }).uuid).toBe("u-1");
  });

  it("cf-api escape hatch validates path + method", async () => {
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "t"
      }
    });
    const badPath = await plugin.invoke("cf-api", { method: "GET", path: "accounts" });
    expect(badPath.ok).toBe(false);
    expect(badPath.error).toMatch(/must start with/);
    const badMethod = await plugin.invoke("cf-api", { method: "OPTIONS", path: "/accounts" });
    expect(badMethod.ok).toBe(false);
    expect(badMethod.error).toMatch(/method must be one of/);
  });

  it("cf-api passes through to arbitrary CF endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/x/queues");
      expect(init?.method).toBe("POST");
      return jsonResponse({ success: true, result: { id: "q-1" } });
    });
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "t"
      }
    });
    const r = await plugin.invoke("cf-api", {
      method: "POST",
      path: "/accounts/x/queues",
      body: { queue_name: "helm" }
    });
    expect(r.ok).toBe(true);
  });

  it("surfaces CF errors verbatim", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: "Authentication error" }]
        }),
        { status: 403 }
      )
    );
    const plugin = new CloudflareAdminPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "cloudflare-admin",
        ALLOWED_HOSTS: "api.cloudflare.com",
        CLOUDFLARE_API_TOKEN: "t",
        CLOUDFLARE_ACCOUNT_ID: "acc-1"
      }
    });
    const r = await plugin.invoke("list-workers", {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Authentication error/);
  });
});
