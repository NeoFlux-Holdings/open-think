import { describe, expect, it } from "vitest";
import { SkillManager } from "../src/core/skills";
import { createRuntimeStub } from "./helpers/runtimeStub";

describe("SkillManager", () => {
  it("lists skills that map to enabled plugins only", () => {
    const mgr = new SkillManager(createRuntimeStub(["cloudflare-api-mcp"]) as never);
    const ids = mgr.listSkills().map((s) => s.id);

    expect(ids).toContain("cf-introspect");
    expect(ids).toContain("cf-list-zones");
    expect(ids).not.toContain("mpp-status");
  });

  it("invokes a known skill via mapped plugin action", async () => {
    const mgr = new SkillManager(createRuntimeStub(["cloudflare-api-mcp"]) as never);
    const result = await mgr.invoke("cf-introspect", { input: { smoke: true } });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      pluginId: "cloudflare-api-mcp",
      action: "introspect"
    });
  });

  it("returns available skill ids for unknown skills", async () => {
    const mgr = new SkillManager(createRuntimeStub(["cloudflare-api-mcp"]) as never);
    const result = await mgr.invoke("missing-skill", {});

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("availableSkills");
  });
});
