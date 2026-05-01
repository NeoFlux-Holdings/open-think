import { describe, expect, it, vi } from "vitest";
import { HelmArtifactsPlugin } from "../src/plugins/artifacts";

function baseConfig() {
  return {
    enabledPlugins: new Set(["helm-artifacts"]),
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

function envOk(extra: Record<string, unknown> = {}) {
  return {
    ENABLED_PLUGINS: "helm-artifacts",
    ALLOWED_HOSTS: "api.cloudflare.com",
    CLOUDFLARE_API_TOKEN: "cf_test",
    CLOUDFLARE_ACCOUNT_ID: "acc-1",
    ARTIFACTS_NAMESPACE: "default",
    ARTIFACTS_REPO: "tomtom",
    ...extra
  };
}

/**
 * Single shared shell-mock so `env.SHELL_CONTAINER.get(...).fetch` always
 * routes through the same dispatch table. The DO API needs a fresh stub
 * per `get()` call, but the underlying fetch impl is shared.
 */
function mockShellContainer(handler: (cmd: string) => { stdout?: string; stderr?: string; ok?: boolean; code?: number }) {
  const fetchMock = vi.fn(async (request: Request) => {
    const body = (await request.json()) as { cmd: string; cwd?: string };
    const r = handler(body.cmd);
    return new Response(
      JSON.stringify({
        ok: r.ok ?? true,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        code: r.code ?? 0,
        durationMs: 1
      }),
      { headers: { "content-type": "application/json" } }
    );
  });
  return {
    idFromName: () => ({ toString: () => "id" }),
    get: () => ({ fetch: fetchMock as unknown as typeof globalThis.fetch })
  };
}

describe("HelmArtifactsPlugin", () => {
  it("status reports not-ready cleanly when token missing", async () => {
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "helm-artifacts", ALLOWED_HOSTS: "api.cloudflare.com" }
    });
    const r = await plugin.invoke("status", {});
    expect(r.ok).toBe(true);
    const data = r.data as { ready: boolean; hasApiToken: boolean; hint: string };
    expect(data.ready).toBe(false);
    expect(data.hasApiToken).toBe(false);
    expect(data.hint).toMatch(/CLOUDFLARE_API_TOKEN|binding/);
  });

  it("status probes the repo via REST when token is set", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      expect(url).toContain("/accounts/acc-1/artifacts/namespaces/default/repos/tomtom");
      return jsonResponse({
        success: true,
        result: {
          id: "repo-1",
          name: "tomtom",
          description: null,
          default_branch: "main",
          remote: "https://acc-1.artifacts.cloudflare.net/git/default/tomtom.git"
        }
      });
    });
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: envOk()
    });
    const r = await plugin.invoke("status", {});
    expect(r.ok).toBe(true);
    const data = r.data as { ready: boolean; repoExists: boolean; remoteUrl: string };
    expect(data.ready).toBe(true);
    expect(data.repoExists).toBe(true);
    expect(data.remoteUrl).toContain("acc-1.artifacts.cloudflare.net");
  });

  it("init creates a new repo via POST /repos when bootstrapUrl absent", async () => {
    let createBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if ((init?.method ?? "GET") === "GET" && url.endsWith("/repos/tomtom")) {
        return jsonResponse({ success: false, errors: [{ message: "not found" }] }, 404);
      }
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/namespaces/default/repos")) {
        createBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(
          {
            success: true,
            result: {
              id: "repo-1",
              name: "tomtom",
              description: "Open Think — tomtom",
              default_branch: "main",
              remote: "https://acc-1.artifacts.cloudflare.net/git/default/tomtom.git",
              token: "art_v1_aaa?expires=99999999999"
            }
          },
          202
        );
      }
      throw new Error("unexpected: " + url);
    });
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: envOk()
    });
    const r = await plugin.invoke("init", {});
    expect(r.ok).toBe(true);
    expect(createBody.name).toBe("tomtom");
    expect(createBody.default_branch).toBe("main");
    const data = r.data as { alreadyExisted: boolean; remoteUrl: string; initialToken: string };
    expect(data.alreadyExisted).toBe(false);
    expect(data.initialToken).toContain("art_v1_");
  });

  it("init returns alreadyExisted when the repo probe succeeds", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        result: {
          id: "r1",
          name: "tomtom",
          description: null,
          default_branch: "main",
          remote: "https://acc-1.artifacts.cloudflare.net/git/default/tomtom.git"
        }
      })
    );
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: envOk()
    });
    const r = await plugin.invoke("init", {});
    expect(r.ok).toBe(true);
    expect((r.data as { alreadyExisted: boolean }).alreadyExisted).toBe(true);
  });

  it("init with bootstrapUrl posts to /import", async () => {
    let importBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if ((init?.method ?? "GET") === "GET" && url.endsWith("/repos/tomtom")) {
        return jsonResponse({ success: false, errors: [{ message: "not found" }] }, 404);
      }
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/repos/tomtom/import")) {
        importBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          success: true,
          result: {
            id: "r1",
            name: "tomtom",
            description: null,
            default_branch: "main",
            remote: "https://acc-1.artifacts.cloudflare.net/git/default/tomtom.git",
            token: "art_v1_bbb?expires=99999999999"
          }
        });
      }
      throw new Error("unexpected: " + url);
    });
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: envOk()
    });
    const r = await plugin.invoke("init", {
      bootstrapUrl: "https://github.com/me/seed.git"
    });
    expect(r.ok).toBe(true);
    expect(importBody.url).toBe("https://github.com/me/seed.git");
    expect(importBody.branch).toBe("main");
    expect((r.data as { bootstrapped: boolean }).bootstrapped).toBe(true);
  });

  it("mint-token via REST returns plaintext + caches it", async () => {
    let postBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/tokens")) {
        postBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          success: true,
          result: {
            id: "tok-1",
            plaintext: "art_v1_ccc?expires=99999999999",
            scope: "write",
            expires_at: "2099-01-01T00:00:00Z"
          }
        });
      }
      throw new Error("unexpected: " + url);
    });
    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: envOk()
    });
    const r = await plugin.invoke("mint-token", { ttl: 600 });
    expect(r.ok).toBe(true);
    expect(postBody.repo).toBe("tomtom");
    expect(postBody.scope).toBe("write");
    expect(postBody.ttl).toBe(600);
    const data = r.data as { token: string; via: string };
    expect(data.token).toContain("art_v1_");
    expect(data.via).toBe("rest");
  });

  it("sync-toml dry-run detects missing-from-toml drift", async () => {
    const tomlContent = `name = "tomtom"\n[ai]\nbinding = "AI"\n`;
    // Pre-set a long-lived token so the plugin doesn't try to mint one.
    const env = envOk({
      AGENT_OWNER_EMAIL: "user@example.com",
      ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999"
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.includes("/workers/scripts/") && url.includes("/settings")) {
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
      throw new Error("unexpected: " + url);
    });

    const shell = mockShellContainer((cmd) => {
      if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
      if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
      if (/git -c http\.extraHeader.*pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
      if (cmd.startsWith("cat 'wrangler.toml'")) return { stdout: tomlContent };
      return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
    });

    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ...env,
        SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
      } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
    });
    const r = await plugin.invoke("sync-toml", { scriptName: "tomtom" });
    expect(r.ok).toBe(true);
    const data = r.data as {
      dryRun: boolean;
      drift: { missingFromToml: Array<{ name: string }> };
      inSync: boolean;
    };
    expect(data.dryRun).toBe(true);
    expect(data.inSync).toBe(false);
    expect(data.drift.missingFromToml).toHaveLength(1);
    expect(data.drift.missingFromToml[0].name).toBe("WORKSPACE");
  });

  it("sync-toml apply commits + pushes the merged content", async () => {
    const tomlContent = `name = "tomtom"\n[ai]\nbinding = "AI"\n`;
    const env = envOk({
      AGENT_OWNER_EMAIL: "user@example.com",
      ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999"
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url.includes("/workers/scripts/") && url.includes("/settings")) {
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
      throw new Error("unexpected: " + url);
    });

    const writes: string[] = [];
    const shell = mockShellContainer((cmd) => {
      if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
      if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
      if (/git -c http\.extraHeader.*pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
      if (cmd.startsWith("cat 'wrangler.toml'")) return { stdout: tomlContent };
      if (cmd.startsWith("mkdir -p")) return { stdout: "" };
      const m = /printf %s '([^']+)' \| base64 -d > 'wrangler\.toml'/.exec(cmd);
      if (m) {
        writes.push(m[1]);
        return { stdout: "" };
      }
      if (cmd.startsWith("git diff --no-color -- 'wrangler.toml'")) return { stdout: "+ [[r2_buckets]]\n" };
      if (cmd.startsWith("git add 'wrangler.toml'")) return { stdout: "" };
      if (/git -c user\.name=Helm.*commit/.test(cmd)) return { stdout: "[main abc] helm: sync wrangler.toml" };
      if (/git -c http\.extraHeader.*push origin/.test(cmd)) return { stdout: "To origin" };
      if (cmd.startsWith("git rev-parse HEAD")) return { stdout: "abc123\n" };
      return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
    });

    const plugin = new HelmArtifactsPlugin();
    await plugin.initialize({
      config: baseConfig(),
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      env: {
        ...env,
        SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
      } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
    });
    const r = await plugin.invoke("sync-toml", { apply: true, scriptName: "tomtom" });
    expect(r.ok).toBe(true);
    const data = r.data as { applied: number; blocks: string[] };
    expect(data.applied).toBe(1);
    expect(writes.length).toBeGreaterThan(0);
    const decoded = atob(writes[0]);
    expect(decoded).toContain(`[[r2_buckets]]`);
    expect(decoded).toContain(`bucket_name = "tomtom-persist"`);
  });
});
