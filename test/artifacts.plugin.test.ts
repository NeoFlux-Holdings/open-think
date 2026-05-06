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

  describe("reconcile (bidirectional)", () => {
    it("returns skipped:true when ARTIFACTS_REPO + AGENT_NAME both unset", async () => {
      const plugin = new HelmArtifactsPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: {
          ENABLED_PLUGINS: "helm-artifacts",
          ALLOWED_HOSTS: "api.cloudflare.com",
          CLOUDFLARE_API_TOKEN: "cf_test"
        }
      });
      const r = await plugin.invoke("reconcile", {});
      expect(r.ok).toBe(true);
      const data = r.data as { skipped: boolean; reason: string };
      expect(data.skipped).toBe(true);
      expect(data.reason).toMatch(/ARTIFACTS_REPO/);
    });

    it("reports no actions when live Worker matches the toml", async () => {
      // Same TOML + same live bindings → drift is empty → reconcile is a no-op.
      const tomlContent =
        `name = "tomtom"\n[ai]\nbinding = "AI"\n` +
        `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "tomtom-persist"\n`;
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
      const r = await plugin.invoke("reconcile", { scriptName: "tomtom" });
      expect(r.ok).toBe(true);
      const data = r.data as {
        inSyncBefore: boolean;
        actions: Array<{ direction: string; ok: boolean }>;
        note: string;
      };
      expect(data.inSyncBefore).toBe(true);
      expect(data.actions).toHaveLength(0);
      expect(data.note).toMatch(/Already in sync/);
    });

    it("commits Worker→Artifacts when live has bindings the toml lacks", async () => {
      // TOML says only AI; live Worker has AI + WORKSPACE → drift.missingFromToml has 1.
      // Reconcile should call sync-toml apply:true to commit the missing block.
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
        if (/git -c user\.name=Helm.*commit/.test(cmd)) return { stdout: "[main abc] reconcile" };
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
      // skipDeploy:true so we only exercise the worker→artifacts branch.
      const r = await plugin.invoke("reconcile", { scriptName: "tomtom", skipDeploy: true });
      expect(r.ok).toBe(true);
      const data = r.data as {
        inSyncBefore: boolean;
        actions: Array<{ direction: string; ok: boolean }>;
      };
      expect(data.inSyncBefore).toBe(false);
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].direction).toBe("worker→artifacts");
      expect(data.actions[0].ok).toBe(true);
      // Verify the file we committed includes the new [[r2_buckets]] block.
      expect(writes.length).toBeGreaterThan(0);
      const decoded = atob(writes[0]);
      expect(decoded).toContain("[[r2_buckets]]");
      expect(decoded).toContain(`bucket_name = "tomtom-persist"`);
    });
  });

  describe("deploy claims canonical (HELM_CUSTOM_DEPLOY)", () => {
    it("sets HELM_CUSTOM_DEPLOY=1 after a successful wrangler deploy", async () => {
      // ARTIFACTS_TOKEN pre-set so this.git skips token-minting.
      const env = envOk({
        AGENT_OWNER_EMAIL: "user@example.com",
        ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999"
      });
      let secretBody: Record<string, unknown> | null = null;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if ((init?.method ?? "GET") === "PUT" && url.endsWith("/secrets")) {
          secretBody = JSON.parse(String(init?.body ?? "{}"));
          return jsonResponse({ success: true, result: { name: "HELM_CUSTOM_DEPLOY" } });
        }
        throw new Error("unexpected: " + url);
      });
      const shell = mockShellContainer((cmd) => {
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/git -c http\.extraHeader.*pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.startsWith("CLOUDFLARE_API_TOKEN=") && cmd.includes("wrangler deploy")) {
          return { stdout: "Deployed to https://tomtom.workers.dev" };
        }
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
      const r = await plugin.invoke("deploy", { scriptName: "tomtom" });
      expect(r.ok).toBe(true);
      expect(secretBody).not.toBeNull();
      const body = secretBody as unknown as { name: string; text: string; type: string };
      expect(body.name).toBe("HELM_CUSTOM_DEPLOY");
      expect(body.text).toBe("1");
      expect(body.type).toBe("secret_text");
      const data = r.data as { claimCanonical: boolean; claim: { ok: boolean } | null };
      expect(data.claimCanonical).toBe(true);
      expect(data.claim?.ok).toBe(true);
    });

    it("skips the flag-set when claimCanonical:false (one-shot test deploy)", async () => {
      const env = envOk({ ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999" });
      let secretCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        if (url.endsWith("/secrets")) secretCalls += 1;
        return jsonResponse({ success: true });
      });
      const shell = mockShellContainer((cmd) => {
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.includes("wrangler deploy")) return { stdout: "Deployed" };
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
      const r = await plugin.invoke("deploy", {
        scriptName: "tomtom",
        claimCanonical: false
      });
      expect(r.ok).toBe(true);
      expect(secretCalls).toBe(0);
    });
  });

  describe("pull-upstream", () => {
    it("dry-run reports behindBy/aheadBy without merging", async () => {
      const env = envOk({ ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999" });
      const shell = mockShellContainer((cmd) => {
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.includes("git remote add upstream")) return { stdout: "" };
        if (cmd.startsWith("git fetch upstream")) return { stdout: "" };
        if (cmd.includes("rev-list --count HEAD..upstream")) return { stdout: "5\n" };
        if (cmd.includes("rev-list --count upstream/")) return { stdout: "2\n" };
        return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
      });
      const plugin = new HelmArtifactsPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: {
          ...env,
          SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
        } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
      });
      const r = await plugin.invoke("pull-upstream", { apply: false });
      expect(r.ok).toBe(true);
      const data = r.data as {
        dryRun: boolean;
        behindBy: number;
        aheadBy: number;
        upstreamUrl: string;
      };
      expect(data.dryRun).toBe(true);
      expect(data.behindBy).toBe(5);
      expect(data.aheadBy).toBe(2);
      expect(data.upstreamUrl).toContain("NeoFlux-Holdings/open-think");
    });

    it("clean merge pushes to Artifacts and reports success", async () => {
      const env = envOk({ ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999" });
      const allCmds: string[] = [];
      const shell = mockShellContainer((cmd) => {
        allCmds.push(cmd);
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.includes("git remote add upstream")) return { stdout: "" };
        if (cmd.startsWith("git fetch upstream")) return { stdout: "" };
        if (cmd.includes("rev-list --count HEAD..upstream")) return { stdout: "3\n" };
        if (cmd.includes("rev-list --count upstream/")) return { stdout: "0\n" };
        if (cmd.startsWith("git checkout ")) return { stdout: "Switched" };
        if (cmd.includes("merge --no-edit")) {
          return { stdout: "Merge made by the 'recursive' strategy." };
        }
        if (cmd.startsWith("git rev-parse HEAD")) return { stdout: "merged-sha\n" };
        if (/git -c http\.extraHeader.*push origin/.test(cmd)) return { stdout: "To origin" };
        return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
      });
      const plugin = new HelmArtifactsPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: {
          ...env,
          SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
        } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
      });
      const r = await plugin.invoke("pull-upstream", {});
      // allCmds is captured for ad-hoc debugging during development
      // (uncomment the next line if you want to see the shell trace).
      // if (!r.ok) console.log(allCmds);
      void allCmds;
      expect(r.ok).toBe(true);
      const data = r.data as {
        merged: boolean;
        pushed: boolean;
        behindBy: number;
        mergeSha: string;
      };
      expect(data.merged).toBe(true);
      expect(data.pushed).toBe(true);
      expect(data.behindBy).toBe(3);
      expect(data.mergeSha).toBe("merged-sha");
    });

    it("up-to-date short-circuits without checkout/merge/push", async () => {
      const env = envOk({ ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999" });
      let mergeAttempts = 0;
      const shell = mockShellContainer((cmd) => {
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.includes("git remote add upstream")) return { stdout: "" };
        if (cmd.startsWith("git fetch upstream")) return { stdout: "" };
        if (cmd.includes("rev-list --count HEAD..upstream")) return { stdout: "0\n" };
        if (cmd.includes("rev-list --count upstream/")) return { stdout: "1\n" };
        if (cmd.includes("merge ") || cmd.includes("checkout main")) {
          mergeAttempts += 1;
          return { stdout: "" };
        }
        return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
      });
      const plugin = new HelmArtifactsPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: {
          ...env,
          SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
        } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
      });
      const r = await plugin.invoke("pull-upstream", {});
      expect(r.ok).toBe(true);
      expect(mergeAttempts).toBe(0);
      const data = r.data as { merged: boolean; behindBy: number };
      expect(data.merged).toBe(false);
      expect(data.behindBy).toBe(0);
    });

    it("conflicts are surfaced + merge is aborted (clean tree)", async () => {
      const env = envOk({ ARTIFACTS_TOKEN: "art_v1_pretoken?expires=99999999999" });
      let abortCalls = 0;
      const allCmds: string[] = [];
      const shell = mockShellContainer((cmd) => {
        allCmds.push(cmd);
        if (cmd.includes("[ -d '/workspace/tomtom/.git' ]")) return { stdout: "CLONED" };
        if (cmd.startsWith("git remote set-url origin")) return { stdout: "" };
        if (/pull --ff-only/.test(cmd)) return { stdout: "Already up to date." };
        if (cmd.includes("git remote add upstream")) return { stdout: "" };
        if (cmd.startsWith("git fetch upstream")) return { stdout: "" };
        if (cmd.includes("rev-list --count HEAD..upstream")) return { stdout: "5\n" };
        if (cmd.includes("rev-list --count upstream/")) return { stdout: "2\n" };
        if (cmd.startsWith("git checkout ")) return { stdout: "Switched" };
        if (cmd.includes("merge --no-edit")) {
          return {
            ok: false,
            code: 1,
            stderr: "CONFLICT (content): Merge conflict in src/conductor.ts",
            stdout: "Auto-merging src/conductor.ts"
          };
        }
        if (cmd.includes("diff --name-only --diff-filter=U")) {
          return { stdout: "src/conductor.ts\nsrc/index.ts\n" };
        }
        if (cmd.includes("merge --abort")) {
          abortCalls += 1;
          return { stdout: "" };
        }
        return { ok: false, code: 127, stderr: `unmocked: ${cmd.slice(0, 80)}` };
      });
      const plugin = new HelmArtifactsPlugin();
      await plugin.initialize({
        config: baseConfig(),
        fetch: globalThis.fetch,
        env: {
          ...env,
          SHELL_CONTAINER: shell as unknown as DurableObjectNamespace
        } as unknown as Parameters<HelmArtifactsPlugin["initialize"]>[0]["env"]
      });
      const r = await plugin.invoke("pull-upstream", {});
      void allCmds; // captured for ad-hoc debug; intentionally unused.
      expect(r.ok).toBe(false);
      expect(abortCalls).toBe(1);
      const data = r.data as { conflicts: string[]; aborted: boolean; merged: boolean };
      expect(data.merged).toBe(false);
      expect(data.aborted).toBe(true);
      expect(data.conflicts).toEqual(["src/conductor.ts", "src/index.ts"]);
    });
  });
});
