import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/core/runtime";
import type { AgentPlugin, PluginCapability } from "../src/core/plugin";
import type { SecretKey } from "../src/core/config";

class TestPlugin implements AgentPlugin {
  readonly id: string = "test-plugin";
  readonly version = "1.0.0";
  readonly description = "test";
  readonly capabilities: readonly PluginCapability[] = ["tools"];
  readonly requiredSecrets: readonly SecretKey[] = [];

  fetchFn?: typeof globalThis.fetch;

  async initialize(context: { fetch: typeof globalThis.fetch }): Promise<void> {
    this.fetchFn = context.fetch;
  }

  async invoke(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

class SecretPlugin extends TestPlugin {
  override readonly id: string = "secret-plugin";
  override readonly requiredSecrets: readonly SecretKey[] = ["mppApiKey"];
}

class EmptyCapabilityPlugin extends TestPlugin {
  override readonly id: string = "empty-capability-plugin";
  override readonly capabilities: readonly PluginCapability[] = [];
}

describe("AgentRuntime", () => {
  it("warns + filters unknown enabled plugins instead of throwing (bundle/config skew tolerance)", async () => {
    // Older bundles may not contain plugin ids that newer ENABLED_PLUGINS
    // defaults reference (e.g. helm-artifacts on a v0.10 bundle). The
    // runtime should boot with the unknown ids dropped + a clear console
    // warning — taking the Worker offline on a config skew is worse than
    // running with a slightly trimmed plugin set.
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const valid = new TestPlugin();
      const runtime = await AgentRuntime.bootstrap(
        {
          ENABLED_PLUGINS: `missing-plugin,${valid.id}`,
          ALLOWED_HOSTS: "api.cloudflare.com"
        },
        [valid]
      );
      expect(runtime.listPlugins().map((p) => p.id)).toEqual([valid.id]);
      expect(warnings.join("\n")).toMatch(/missing-plugin/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("fails fast when a required secret is missing", async () => {
    const plugin = new SecretPlugin();

    await expect(
      AgentRuntime.bootstrap(
        {
          ENABLED_PLUGINS: "secret-plugin",
          ALLOWED_HOSTS: "api.cloudflare.com"
        },
        [plugin]
      )
    ).rejects.toThrowError(/missing required secrets/);
  });

  it("rejects duplicate plugin IDs in registry", async () => {
    await expect(
      AgentRuntime.bootstrap(
        {
          ENABLED_PLUGINS: "test-plugin",
          ALLOWED_HOSTS: "api.cloudflare.com"
        },
        [new TestPlugin(), new TestPlugin()]
      )
    ).rejects.toThrowError(/Duplicate plugin ID/);
  });

  it("rejects plugins without capabilities", async () => {
    await expect(
      AgentRuntime.bootstrap(
        {
          ENABLED_PLUGINS: "empty-capability-plugin",
          ALLOWED_HOSTS: "api.cloudflare.com"
        },
        [new EmptyCapabilityPlugin()]
      )
    ).rejects.toThrowError(/at least one capability/);
  });

  it("blocks outbound fetch to non-allow-listed hosts", async () => {
    const plugin = new TestPlugin();

    await AgentRuntime.bootstrap(
      {
        ENABLED_PLUGINS: "test-plugin",
        ALLOWED_HOSTS: "api.cloudflare.com"
      },
      [plugin]
    );

    await expect(plugin.fetchFn!("https://example.com")).rejects.toThrowError(/ALLOWED_HOSTS/);
  });
});
