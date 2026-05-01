import { describe, expect, it, vi } from "vitest";
import { HelmGithubPlugin } from "../src/plugins/helmGithub";

function baseConfig() {
  return {
    enabledPlugins: new Set(["helm-github"]),
    allowedHosts: new Set(["api.github.com", "api.cloudflare.com"]),
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

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

describe("HelmGithubPlugin", () => {
  it("status reports missing token cleanly", async () => {
    const plugin = new HelmGithubPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "helm-github", ALLOWED_HOSTS: "api.github.com" }
    });
    const r = await plugin.invoke("status", {});
    expect(r.ok).toBe(true);
    const data = r.data as { hasToken: boolean; hint: string };
    expect(data.hasToken).toBe(false);
    expect(data.hint).toMatch(/GITHUB_TOKEN/);
  });

  it("read-file returns decoded UTF-8 content", async () => {
    const fileBody = `name = "tomtom-agent"\n`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toContain("/repos/me/myrepo/contents/wrangler.toml");
      return jsonResponse({
        content: b64(fileBody),
        encoding: "base64",
        sha: "abc123",
        size: fileBody.length,
        html_url: "https://github.com/me/myrepo/blob/main/wrangler.toml"
      });
    });
    const plugin = new HelmGithubPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "helm-github",
        ALLOWED_HOSTS: "api.github.com",
        GITHUB_TOKEN: "ghp_test",
        GITHUB_REPO: "me/myrepo"
      }
    });
    const r = await plugin.invoke("read-file", {});
    expect(r.ok).toBe(true);
    const data = r.data as { content: string; sha: string };
    expect(data.content).toBe(fileBody);
    expect(data.sha).toBe("abc123");
  });

  it("write-file looks up sha then PUTs with it", async () => {
    let getCalls = 0;
    let putCalls = 0;
    let putBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const method = init?.method ?? "GET";
      if (method === "GET") {
        getCalls += 1;
        return jsonResponse({
          content: b64("old\n"), encoding: "base64", sha: "old-sha-1"
        });
      }
      if (method === "PUT") {
        putCalls += 1;
        putBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({ commit: { sha: "new-sha-1", html_url: "https://github.com/me/myrepo/commit/new-sha-1" } });
      }
      throw new Error("unexpected: " + method + " " + url);
    });
    const plugin = new HelmGithubPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "helm-github",
        ALLOWED_HOSTS: "api.github.com",
        GITHUB_TOKEN: "ghp_test",
        GITHUB_REPO: "me/myrepo"
      }
    });
    const r = await plugin.invoke("write-file", {
      path: "wrangler.toml",
      content: "name = \"new\"\n",
      message: "test commit"
    });
    expect(r.ok).toBe(true);
    expect(getCalls).toBe(1);
    expect(putCalls).toBe(1);
    expect(putBody.sha).toBe("old-sha-1");
    expect(putBody.message).toBe("test commit");
    // Verify content was base64-encoded.
    expect(typeof putBody.content).toBe("string");
    expect(atob(String(putBody.content))).toContain("new");
    const data = r.data as { commitSha: string; replacedExisting: boolean };
    expect(data.commitSha).toBe("new-sha-1");
    expect(data.replacedExisting).toBe(true);
  });

  it("sync-toml dry-run: detects missing-from-toml drift", async () => {
    const tomlContent = `name = "x"\n[ai]\nbinding = "AI"\n`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.includes("api.cloudflare.com") && url.includes("/settings")) {
        return jsonResponse({
          success: true,
          result: {
            bindings: [
              { type: "ai", name: "AI" },
              { type: "r2_bucket", name: "WORKSPACE", bucket_name: "tomtom-persist" }
            ]
          }
        });
      }
      if (url.includes("api.github.com") && url.includes("/contents/wrangler.toml")) {
        return jsonResponse({
          content: b64(tomlContent), encoding: "base64", sha: "t-1"
        });
      }
      throw new Error("unexpected: " + url);
    });
    const plugin = new HelmGithubPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "helm-github",
        ALLOWED_HOSTS: "api.github.com,api.cloudflare.com",
        GITHUB_TOKEN: "ghp_test",
        GITHUB_REPO: "me/myrepo",
        CLOUDFLARE_API_TOKEN: "cf_test",
        CLOUDFLARE_ACCOUNT_ID: "acc-1"
      }
    });
    const r = await plugin.invoke("sync-toml", { scriptName: "tomtom" });
    expect(r.ok).toBe(true);
    const data = r.data as { dryRun: boolean; drift: { missingFromToml: Array<{ name: string }> }; inSync: boolean };
    expect(data.dryRun).toBe(true);
    expect(data.inSync).toBe(false);
    expect(data.drift.missingFromToml).toHaveLength(1);
    expect(data.drift.missingFromToml[0].name).toBe("WORKSPACE");
  });

  it("sync-toml apply: PUTs the merged content with the new binding", async () => {
    const tomlContent = `name = "x"\n[ai]\nbinding = "AI"\n`;
    let putBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("api.cloudflare.com") && url.includes("/settings")) {
        return jsonResponse({
          success: true,
          result: {
            bindings: [
              { type: "ai", name: "AI" },
              { type: "r2_bucket", name: "WORKSPACE", bucket_name: "tomtom-persist" }
            ]
          }
        });
      }
      if (url.includes("api.github.com") && url.includes("/contents/wrangler.toml")) {
        if (method === "PUT") {
          putBody = JSON.parse(String(init?.body ?? "{}"));
          return jsonResponse({ commit: { sha: "newsha" } });
        }
        return jsonResponse({ content: b64(tomlContent), encoding: "base64", sha: "t-1" });
      }
      throw new Error("unexpected: " + url);
    });
    const plugin = new HelmGithubPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "helm-github",
        ALLOWED_HOSTS: "api.github.com,api.cloudflare.com",
        GITHUB_TOKEN: "ghp_test",
        GITHUB_REPO: "me/myrepo",
        CLOUDFLARE_API_TOKEN: "cf_test",
        CLOUDFLARE_ACCOUNT_ID: "acc-1"
      }
    });
    const r = await plugin.invoke("sync-toml", { apply: true, scriptName: "tomtom" });
    expect(r.ok).toBe(true);
    const data = r.data as { applied: number; blocks: string[] };
    expect(data.applied).toBe(1);
    const newContent = atob(String(putBody.content));
    expect(newContent).toContain(`[[r2_buckets]]`);
    expect(newContent).toContain(`bucket_name = "tomtom-persist"`);
  });
});
