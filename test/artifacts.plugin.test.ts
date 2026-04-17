import { describe, expect, it, vi } from "vitest";
import { ArtifactsPlugin } from "../src/plugins/artifacts";

function repoHandle(remote = "https://example.repo", token = "secret") {
  return {
    remote,
    token,
    async fork(name: string) {
      return repoHandle(`https://example.repo/${name}`, `${name}-token`);
    }
  };
}

describe("ArtifactsPlugin", () => {
  it("requires ARTIFACTS binding", async () => {
    const plugin = new ArtifactsPlugin();

    await expect(
      plugin.initialize({
        config: {
          enabledPlugins: new Set(["artifacts"]),
          allowedHosts: new Set(["api.cloudflare.com"]),
          modelDefault: "gpt-4.1-mini",
          alertErrorRatePct: 5
        },
        fetch,
        env: {
          ENABLED_PLUGINS: "artifacts",
          ALLOWED_HOSTS: "api.cloudflare.com"
        }
      })
    ).rejects.toThrowError(/ARTIFACTS binding/);
  });

  it("creates repository when create-repo is invoked", async () => {
    const plugin = new ArtifactsPlugin();

    await plugin.initialize({
      config: {
        enabledPlugins: new Set(["artifacts"]),
        allowedHosts: new Set(["api.cloudflare.com"]),
        modelDefault: "gpt-4.1-mini",
        alertErrorRatePct: 5
      },
      fetch: vi.fn(async () => new Response()) as typeof globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "artifacts",
        ALLOWED_HOSTS: "api.cloudflare.com",
        ARTIFACTS: {
          create: async () => repoHandle(),
          get: async () => repoHandle(),
          import: async () => ({ remote: "https://import.repo", token: "import-token" })
        }
      }
    });

    const result = await plugin.invoke("create-repo", { name: "session-1" });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ remote: "https://example.repo" });
  });
});
