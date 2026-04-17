#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const id = process.argv[2];

if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error("Usage: npm run plugin:new -- <plugin-id>");
  console.error("plugin-id must match: ^[a-z0-9-]+$");
  process.exit(1);
}

const toClassName = (value) =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") + "Plugin";

const className = toClassName(id);
const pluginDir = "src/plugins/community";
const testDir = "test/community";
const pluginPath = join(pluginDir, `${id}.ts`);
const testPath = join(testDir, `${id}.test.ts`);

mkdirSync(pluginDir, { recursive: true });
mkdirSync(testDir, { recursive: true });

if (existsSync(pluginPath) || existsSync(testPath)) {
  console.error(`Refusing to overwrite existing files for '${id}'.`);
  process.exit(1);
}

const pluginSource = `import type { AgentPlugin, PluginContext, PluginResult } from "../../core/plugin";

export class ${className} implements AgentPlugin {
  readonly id = "${id}";
  readonly version = "0.1.0";
  readonly description = "Community plugin: ${id}";
  readonly capabilities = ["tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "status") {
      return {
        ok: true,
        data: {
          plugin: this.id,
          modelDefault: this.ctx.config.modelDefault,
          input: input ?? null
        }
      };
    }

    return { ok: false, error: \
\`Unknown action: \${action}\` };
  }
}
`;

const testSource = `import { describe, expect, it } from "vitest";
import { ${className} } from "../../src/plugins/community/${id}";

describe("${className}", () => {
  it("returns status data", async () => {
    const plugin = new ${className}();

    await plugin.initialize({
      config: {
        enabledPlugins: new Set(["${id}"]),
        allowedHosts: new Set(["api.cloudflare.com"]),
        modelDefault: "gpt-4.1-mini",
        alertErrorRatePct: 5
      },
      fetch: globalThis.fetch,
      env: { ENABLED_PLUGINS: "${id}", ALLOWED_HOSTS: "api.cloudflare.com" }
    });

    const result = await plugin.invoke("status", { ok: true });

    expect(result.ok).toBe(true);
  });
});
`;

writeFileSync(pluginPath, pluginSource, "utf8");
writeFileSync(testPath, testSource, "utf8");

console.log(`Created plugin scaffold:\n- ${pluginPath}\n- ${testPath}`);
console.log("Next: export your plugin from src/plugins/registry.ts and enable it in config.");
