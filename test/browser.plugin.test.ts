import { describe, expect, it, vi } from "vitest";
import { BrowserPlugin } from "../src/plugins/browser";

function config() {
  return {
    enabledPlugins: new Set(["browser"]),
    allowedHosts: new Set(["example.com"]),
    modelDefault: "model-x",
    alertErrorRatePct: 5
  };
}

describe("BrowserPlugin", () => {
  it("requires BROWSER binding", async () => {
    const plugin = new BrowserPlugin();
    await expect(
      plugin.initialize({
        config: config(),
        fetch: globalThis.fetch,
        env: { ENABLED_PLUGINS: "browser", ALLOWED_HOSTS: "example.com" }
      })
    ).rejects.toThrowError(/BROWSER binding/);
  });

  it("fetches via the BROWSER binding", async () => {
    const browserFetch = vi.fn(async () =>
      new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const plugin = new BrowserPlugin();

    await plugin.initialize({
      config: config(),
      fetch: globalThis.fetch,
      env: {
        ENABLED_PLUGINS: "browser",
        ALLOWED_HOSTS: "example.com",
        BROWSER: { fetch: browserFetch } as unknown as Fetcher
      }
    });

    const result = await plugin.invoke("fetch", { url: "https://example.com" });
    expect(result.ok).toBe(true);
    expect(browserFetch).toHaveBeenCalledOnce();
  });
});
