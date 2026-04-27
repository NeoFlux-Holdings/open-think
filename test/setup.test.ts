import { describe, expect, it } from "vitest";
import { collectStatus, generateSnippet } from "../src/setup";
import type { Env } from "../src/types";
import type { AgentRuntime } from "../src/core/runtime";

function fakeRuntime(pluginIds: string[]): AgentRuntime {
  return {
    listPlugins: () =>
      pluginIds.map((id) => ({ id, version: "1.0.0", description: id, capabilities: ["tools"] }))
  } as unknown as AgentRuntime;
}

describe("collectStatus", () => {
  const baseEnv: Env = {
    ENABLED_PLUGINS: "workers-ai",
    ALLOWED_HOSTS: "api.cloudflare.com"
  };

  it("returns a readiness score based on configured capabilities", () => {
    const status = collectStatus(baseEnv, fakeRuntime(["workers-ai"]));
    expect(status.readinessScore).toBeGreaterThanOrEqual(0);
    expect(status.readinessScore).toBeLessThanOrEqual(100);
    expect(status.capabilities.length).toBeGreaterThan(5);
    expect(status.enabledPlugins).toContain("workers-ai");
  });

  it("flags anthropic as missing when plugin enabled but key absent", () => {
    const status = collectStatus(
      { ...baseEnv, ENABLED_PLUGINS: "workers-ai,anthropic" },
      fakeRuntime(["workers-ai", "anthropic"])
    );
    const anthropic = status.capabilities.find((c) => c.id === "anthropic");
    expect(anthropic?.enabled).toBe(true);
    expect(anthropic?.configured).toBe(false);
    expect(anthropic?.missing).toContain("ANTHROPIC_API_KEY");
  });

  it("detects CF MCP when URL points at mcp.cloudflare.com", () => {
    const status = collectStatus(
      { ...baseEnv, MCP_DEFAULT_URL: "https://mcp.cloudflare.com/mcp" },
      fakeRuntime(["mcp-client"])
    );
    expect(status.mcpBridge.configured).toBe(true);
    expect(status.mcpBridge.provider).toBe("cloudflare");
  });

  it("recommends cf-ai-gateway when it's not yet enabled", () => {
    const status = collectStatus(baseEnv, fakeRuntime(["workers-ai"]));
    expect(status.recommended.join(" ")).toMatch(/cf-ai-gateway/i);
  });
});

describe("generateSnippet", () => {
  const baseEnv: Env = {
    ENABLED_PLUGINS: "workers-ai",
    ALLOWED_HOSTS: "api.cloudflare.com"
  };

  it("merges new plugins with existing ENABLED_PLUGINS", () => {
    const snippet = generateSnippet(baseEnv, { enablePlugins: ["cf-ai-gateway", "anthropic"] });
    expect(snippet.wrangler).toContain('ENABLED_PLUGINS = "workers-ai,cf-ai-gateway,anthropic"');
    expect(snippet.wrangler).toContain("gateway.ai.cloudflare.com");
    expect(snippet.wrangler).toContain("api.anthropic.com");
    expect(snippet.devVars).toContain("AI_GATEWAY_ID");
    expect(snippet.devVars).toContain("ANTHROPIC_API_KEY");
  });

  it("returns a helpful empty state when no plugins selected", () => {
    const snippet = generateSnippet(baseEnv, { enablePlugins: [] });
    expect(snippet.devVars).toContain("no new env vars");
  });

  it("notes the Codex bridge deployment when codex is picked", () => {
    const snippet = generateSnippet(baseEnv, { enablePlugins: ["codex"] });
    expect(snippet.notes.join(" ")).toMatch(/codex-bridge/);
    expect(snippet.devVars).toContain("CODEX_APP_SERVER_URL");
  });

  it("notes the browser binding manual step", () => {
    const snippet = generateSnippet(baseEnv, { enablePlugins: ["browser"] });
    expect(snippet.notes.join(" ")).toMatch(/\[browser\] binding/);
  });
});
