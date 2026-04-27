import { describe, expect, it, vi } from "vitest";
import { WorkersAiPlugin } from "../src/plugins/workersAi";

function config() {
  return {
    enabledPlugins: new Set(["workers-ai"]),
    allowedHosts: new Set(["api.cloudflare.com"]),
    modelDefault: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    alertErrorRatePct: 5
  };
}

describe("WorkersAiPlugin", () => {
  it("fails to initialize without AI binding", async () => {
    const plugin = new WorkersAiPlugin();
    await expect(
      plugin.initialize({
        config: config(),
        fetch: globalThis.fetch,
        env: { ENABLED_PLUGINS: "workers-ai", ALLOWED_HOSTS: "api.cloudflare.com" }
      })
    ).rejects.toThrowError(/AI binding/);
  });

  it("runs chat with mocked AI binding and returns response", async () => {
    const run = vi.fn(
      async (
        _model: string,
        _input: Record<string, unknown>,
        _opts?: Record<string, unknown>
      ) => ({ response: "hi there" })
    );
    const plugin = new WorkersAiPlugin();

    await plugin.initialize({
      config: config(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "api.cloudflare.com",
        AI: { run } as unknown as Ai
      }
    });

    const result = await plugin.invoke("chat", {
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    const call = run.mock.calls[0];
    expect(typeof call[0]).toBe("string");
    expect(call[1]).toMatchObject({ messages: [{ role: "user", content: "hi" }] });
  });

  it("rejects chat with empty messages", async () => {
    const plugin = new WorkersAiPlugin();
    await plugin.initialize({
      config: config(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "workers-ai",
        ALLOWED_HOSTS: "api.cloudflare.com",
        AI: { run: vi.fn() } as unknown as Ai
      }
    });

    const result = await plugin.invoke("chat", { messages: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/messages/);
  });
});
