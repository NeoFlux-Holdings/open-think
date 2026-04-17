import { describe, expect, it } from "vitest";
import { MppPlugin } from "../src/plugins/mpp";

describe("MppPlugin", () => {
  it("returns error if list-models API call fails", async () => {
    const plugin = new MppPlugin();

    await plugin.initialize({
      config: {
        enabledPlugins: new Set(["mpp"]),
        allowedHosts: new Set(["api.mpp.dev"]),
        modelDefault: "gpt-4.1-mini",
        alertErrorRatePct: 5,
        mppApiKey: "test-key"
      },
      fetch: async () => new Response(JSON.stringify({ success: false }), { status: 401 }),
      env: { ENABLED_PLUGINS: "", ALLOWED_HOSTS: "" }
    });

    const result = await plugin.invoke("list-models", null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mpp API error/);
  });
});
