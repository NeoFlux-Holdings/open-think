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

  describe("update (self-update)", () => {
    const MANIFEST_URL = "https://manifest.example.invalid/m.json";
    const MODULE_URL = "https://manifest.example.invalid/helm.mjs";
    const SAMPLE_MANIFEST = {
      sha: "newsha789",
      version: "v1.2.3",
      moduleUrl: MODULE_URL,
      metadata: {
        main_module: "index.mjs",
        compatibility_date: "2026-04-16",
        compatibility_flags: ["nodejs_compat_v2"],
        bindings: [
          { type: "ai", name: "AI" },
          {
            type: "durable_object_namespace",
            name: "AGENT_SESSIONS",
            class_name: "AgentSessionDO"
          }
        ],
        migrations: [{ tag: "v1", new_sqlite_classes: ["AgentSessionDO"] }]
      }
    };

    it("short-circuits when env.BUILD_SHA matches the manifest sha", async () => {
      let manifestFetches = 0;
      let uploadCalls = 0;
      const fetchMock = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) {
          manifestFetches += 1;
          return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        }
        if (url.includes("/workers/scripts/")) uploadCalls += 1;
        return new Response("nope", { status: 500 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid,api.cloudflare.com",
          BUILD_SHA: "newsha789",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(true);
      const data = r.data as {
        action: string;
        currentSha: string;
        manifestSha: string;
        version: string;
      };
      expect(data.action).toBe("already-up-to-date");
      expect(data.currentSha).toBe("newsha789");
      expect(data.manifestSha).toBe("newsha789");
      expect(data.version).toBe("v1.2.3");
      expect(manifestFetches).toBe(1);
      expect(uploadCalls).toBe(0);
    });

    it("refuses to upload without CLOUDFLARE_API_TOKEN when sha differs", async () => {
      const fetchMock = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        }
        return new Response("nope", { status: 500 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid",
          BUILD_SHA: "stale-sha-aaa",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL
          // No CLOUDFLARE_API_TOKEN
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/CLOUDFLARE_API_TOKEN/);
    });

    it("uploads with merged bindings + stamps BUILD_SHA on the happy path", async () => {
      let uploadedMetadata: Record<string, unknown> | null = null;
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        }
        if (url === MODULE_URL) {
          return new Response(new ArrayBuffer(2048), { status: 200 });
        }
        // Account auto-resolve (when no CLOUDFLARE_ACCOUNT_ID).
        if (url.includes("/accounts?per_page=10")) {
          return new Response(
            JSON.stringify({ success: true, result: [{ id: "acc-1", name: "test" }] }),
            { status: 200 }
          );
        }
        // Customer's existing bindings (their D1 ID + secret).
        if (url.endsWith("/settings")) {
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                bindings: [
                  { type: "d1", name: "DB", database_id: "their-uuid", database_name: "their-db" },
                  { type: "secret_text", name: "ANTHROPIC_API_KEY" }
                ]
              }
            }),
            { status: 200 }
          );
        }
        // Upload PUT.
        if (url.match(/\/workers\/scripts\/[^/]+$/)) {
          const form = await (init?.body as FormData);
          const meta = form?.get?.("metadata") as Blob | null;
          if (meta) uploadedMetadata = JSON.parse(await meta.text());
          return new Response(
            JSON.stringify({ success: true, result: { id: "helm", etag: "etag-1" } }),
            { status: 200 }
          );
        }
        // resolveScript falls through to /workers/scripts list when AGENT_NAME unset.
        if (url.endsWith("/workers/scripts")) {
          return new Response(
            JSON.stringify({ success: true, result: [{ id: "helm", modified_on: "2026-04-01" }] }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid,api.cloudflare.com",
          BUILD_SHA: "stale-sha-aaa",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL,
          CLOUDFLARE_API_TOKEN: "cf_test",
          CLOUDFLARE_ACCOUNT_ID: "acc-1",
          AGENT_NAME: "helm"
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(true);
      const data = r.data as { action: string; previousSha: string; newSha: string };
      expect(data.action).toBe("updated");
      expect(data.previousSha).toBe("stale-sha-aaa");
      expect(data.newSha).toBe("newsha789");
      expect(uploadedMetadata).not.toBeNull();
      // Cast through `unknown` because the compiler can't narrow that
      // uploadedMetadata is non-null after the assertion above (the
      // closure means it doesn't track the narrowing).
      const meta = uploadedMetadata as unknown as {
        bindings: Array<Record<string, unknown>>;
        migrations?: { new_tag?: string; new_sqlite_classes?: string[] };
      };
      const bindings = meta.bindings;
      // Manifest's AI binding is present.
      expect(bindings.find((b) => b.name === "AI")).toBeTruthy();
      // Customer's D1 with database_id is preserved.
      const dbBinding = bindings.find((b) => b.name === "DB");
      expect(dbBinding?.database_id).toBe("their-uuid");
      // BUILD_SHA stamped to the new sha.
      const buildShaB = bindings.find((b) => b.name === "BUILD_SHA");
      expect(buildShaB?.type).toBe("plain_text");
      expect(buildShaB?.text).toBe("newsha789");
      // Migration shape: array → flattened object with new_tag.
      expect(meta.migrations?.new_tag).toBe("v1");
      expect(meta.migrations?.new_sqlite_classes).toContain("AgentSessionDO");
    });

    it("clears HELM_CUSTOM_DEPLOY after successful upload (back to upstream)", async () => {
      let deleteCalls = 0;
      let deleteUrl = "";
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        }
        if (url === MODULE_URL) {
          return new Response(new ArrayBuffer(1024), { status: 200 });
        }
        if (url.endsWith("/settings")) {
          return new Response(
            JSON.stringify({ success: true, result: { bindings: [] } }),
            { status: 200 }
          );
        }
        if (url.endsWith("/secrets/HELM_CUSTOM_DEPLOY") && (init?.method ?? "GET") === "DELETE") {
          deleteCalls += 1;
          deleteUrl = url;
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.match(/\/workers\/scripts\/[^/]+$/)) {
          return new Response(
            JSON.stringify({ success: true, result: { id: "helm" } }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid,api.cloudflare.com",
          BUILD_SHA: "old-sha",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL,
          CLOUDFLARE_API_TOKEN: "cf_test",
          CLOUDFLARE_ACCOUNT_ID: "acc-1",
          AGENT_NAME: "helm"
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(true);
      expect(deleteCalls).toBe(1);
      expect(deleteUrl).toContain("/secrets/HELM_CUSTOM_DEPLOY");
      const data = r.data as { clearedSelfManaged: boolean };
      expect(data.clearedSelfManaged).toBe(true);
    });

    it("clearedSelfManaged is true even when secret didn't exist (404)", async () => {
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        if (url === MODULE_URL) return new Response(new ArrayBuffer(1024), { status: 200 });
        if (url.endsWith("/settings")) {
          return new Response(JSON.stringify({ success: true, result: { bindings: [] } }), { status: 200 });
        }
        if (url.endsWith("/secrets/HELM_CUSTOM_DEPLOY") && (init?.method ?? "GET") === "DELETE") {
          return new Response("not found", { status: 404 });
        }
        if (url.match(/\/workers\/scripts\/[^/]+$/)) {
          return new Response(JSON.stringify({ success: true, result: { id: "helm" } }), { status: 200 });
        }
        return new Response("nope", { status: 500 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid,api.cloudflare.com",
          BUILD_SHA: "old-sha",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL,
          CLOUDFLARE_API_TOKEN: "cf_test",
          CLOUDFLARE_ACCOUNT_ID: "acc-1",
          AGENT_NAME: "helm"
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(true);
      // 404 = "not flagged" = treat as success (idempotent clear).
      expect((r.data as { clearedSelfManaged: boolean }).clearedSelfManaged).toBe(true);
    });

    it("force:true uploads even when shas match", async () => {
      let uploadCalls = 0;
      const fetchMock = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 });
        }
        if (url === MODULE_URL) {
          return new Response(new ArrayBuffer(1024), { status: 200 });
        }
        if (url.endsWith("/settings")) {
          return new Response(
            JSON.stringify({ success: true, result: { bindings: [] } }),
            { status: 200 }
          );
        }
        if (url.match(/\/workers\/scripts\/[^/]+$/)) {
          uploadCalls += 1;
          return new Response(
            JSON.stringify({ success: true, result: { id: "helm" } }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;

      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid,api.cloudflare.com",
          BUILD_SHA: "newsha789", // matches manifest, would normally short-circuit
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL,
          CLOUDFLARE_API_TOKEN: "cf_test",
          CLOUDFLARE_ACCOUNT_ID: "acc-1",
          AGENT_NAME: "helm"
        }
      });
      const r = await plugin.invoke("update", { force: true });
      expect(r.ok).toBe(true);
      expect((r.data as { action: string }).action).toBe("updated");
      expect(uploadCalls).toBe(1);
    });

    it("surfaces a clean error when manifest fetch fails", async () => {
      const fetchMock = (async () => new Response("upstream offline", { status: 502 })) as unknown as typeof fetch;
      const plugin = new HelmSetupPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: fetchMock,
        runtime: fakeRuntime(),
        env: {
          ENABLED_PLUGINS: "helm-setup",
          ALLOWED_HOSTS: "manifest.example.invalid",
          BUILD_SHA: "anything",
          HELM_BUNDLE_MANIFEST_URL: MANIFEST_URL,
          CLOUDFLARE_API_TOKEN: "cf_test"
        }
      });
      const r = await plugin.invoke("update", {});
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/manifest fetch/);
    });
  });
});
