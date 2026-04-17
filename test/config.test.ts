import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config";

describe("parseConfig", () => {
  it("parses plugin and host allow-lists", () => {
    const cfg = parseConfig({
      ENABLED_PLUGINS: "cloudflare-api-mcp,mpp",
      ALLOWED_HOSTS: "api.cloudflare.com,api.mpp.dev"
    });

    expect(cfg.enabledPlugins.has("mpp")).toBe(true);
    expect(cfg.allowedHosts.has("api.cloudflare.com")).toBe(true);
  });


  it("parses alert threshold with sane default", () => {
    const cfg = parseConfig({
      ENABLED_PLUGINS: "cloudflare-api-mcp",
      ALLOWED_HOSTS: "api.cloudflare.com",
      ALERT_ERROR_RATE_PCT: "7.5"
    });

    expect(cfg.alertErrorRatePct).toBe(7.5);
  });

  it("throws when enabled plugins are missing", () => {
    expect(() =>
      parseConfig({
        ENABLED_PLUGINS: "",
        ALLOWED_HOSTS: "api.cloudflare.com"
      })
    ).toThrowError(/ENABLED_PLUGINS/);
  });
});
