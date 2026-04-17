import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/core/runtime";
import type { AgentPlugin } from "../src/core/plugin";

class TestPlugin implements AgentPlugin {
  readonly id = "test-plugin";
  readonly version = "1.0.0";
  readonly description = "test";
  readonly capabilities = ["tools"] as const;
  readonly requiredSecrets = [] as const;

  fetchFn?: typeof globalThis.fetch;

  async initialize(context: { fetch: typeof globalThis.fetch }): Promise<void> {
    this.fetchFn = context.fetch;
  }

  async invoke(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

class SecretPlugin extends TestPlugin {
  override readonly id = "secret-plugin";
  override readonly requiredSecrets = ["mppApiKey"] as const;
}

class EmptyCapabilityPlugin extends TestPlugin {
  override readonly id = "empty-capability-plugin";
  override readonly capabilities = [] as const;
}

describe("AgentRuntime", () => {
  it("rejects unknown enabled plugins", async () => {
    await expect(
      AgentRuntime.bootstrap(
        {
          ENABLED_PLUGINS: "missing-plugin",
          ALLOWED_HOSTS: "api.cloudflare.com"
        },
        []
      )
    ).rejects.toThrowError(/not registered/);
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
