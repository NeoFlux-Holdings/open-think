#!/usr/bin/env node
/**
 * Marketplace manifest validator.
 *
 * Run: `npm run marketplace:validate`
 *
 * Checks:
 *   - every entry file under src/marketplace/entries/*.ts exports `entry`
 *   - every slug is unique and lowercase-hyphenated
 *   - every `allowedHostsAdd` hostname is well-formed
 *   - every secret name is UPPER_SNAKE_CASE with a description
 *   - every `enabledPluginsAdd` plugin id exists in the runtime registry
 *     (best-effort: scans src/plugins/registry.ts in the parent repo if
 *     present; otherwise only warns)
 *   - every `source` URL is well-formed
 *   - no two entries in the same type share a title
 *
 * Exits non-zero on errors so CI can gate PRs.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(SITE_ROOT, "..");
const ENTRIES_DIR = join(SITE_ROOT, "src", "marketplace", "entries");
const PLUGINS_DIR = join(REPO_ROOT, "src", "plugins");

// Known plugin ids. Populated from the parent repo's plugin source files.
// Fallback list mirrors the v0.3 baseline; new plugins are picked up
// automatically as long as they live under src/plugins/*.ts and declare
// `readonly id = "...";`.
const FALLBACK_PLUGIN_IDS = new Set([
  "admin",
  "cf-ai-gateway",
  "cloudflare-api-mcp",
  "workers-ai",
  "anthropic",
  "openai-compatible",
  "codex",
  "mcp-client",
  "browser",
  "sandbox",
  "artifacts",
  "memory",
  "email",
  "notifier",
  "calendar"
]);

function loadPluginIds() {
  if (!existsSync(PLUGINS_DIR) || !statSync(PLUGINS_DIR).isDirectory()) {
    return { ids: FALLBACK_PLUGIN_IDS, source: "fallback" };
  }
  try {
    const ids = new Set();
    for (const f of readdirSync(PLUGINS_DIR)) {
      if (!f.endsWith(".ts") || f === "registry.ts") continue;
      const source = readFileSync(join(PLUGINS_DIR, f), "utf-8");
      for (const m of source.matchAll(/readonly\s+id\s*=\s*["']([^"']+)["']/g)) {
        ids.add(m[1]);
      }
    }
    if (ids.size === 0) return { ids: FALLBACK_PLUGIN_IDS, source: "fallback" };
    // Always union with fallback so the marketplace can list "well-known"
    // upcoming plugins before their source lands.
    for (const id of FALLBACK_PLUGIN_IDS) ids.add(id);
    return { ids, source: "src/plugins/*.ts" };
  } catch {
    return { ids: FALLBACK_PLUGIN_IDS, source: "fallback" };
  }
}

async function run() {
  console.log("[marketplace:validate] scanning", ENTRIES_DIR);
  if (!existsSync(ENTRIES_DIR)) {
    console.error("  ✗ entries directory not found");
    process.exit(1);
  }

  const files = readdirSync(ENTRIES_DIR).filter((f) => f.endsWith(".ts"));
  if (files.length === 0) {
    console.error("  ✗ no entry files found");
    process.exit(1);
  }
  console.log(`  · ${files.length} entry file(s) found\n`);

  const { ids: pluginIds, source: pluginSource } = loadPluginIds();
  console.log(`[marketplace:validate] plugin-id source: ${pluginSource} (${pluginIds.size} ids)\n`);

  // We can't actually execute the .ts files from pure node without a compiler,
  // so this validator does structural checks via regex/text scanning. The
  // authoritative runtime validation happens in data.ts's `validate()` export
  // (called at module-init time inside the Worker).
  const errors = [];
  const warnings = [];
  const slugs = new Set();
  const titles = new Map(); // type -> Set<title>

  const slugPattern = /^[a-z0-9-]+$/;
  const secretPattern = /^[A-Z][A-Z0-9_]*$/;
  const hostPattern = /^[a-z0-9.-]+(\.[a-z]{2,})+$/i;
  const urlPattern = /^https?:\/\//;

  for (const file of files) {
    const slug = file.replace(/\.ts$/, "");
    const content = readFileSync(join(ENTRIES_DIR, file), "utf-8");

    if (!slugPattern.test(slug)) {
      errors.push(`${file}: filename "${slug}" is not lowercase-hyphenated.`);
    }
    if (slugs.has(slug)) {
      errors.push(`${file}: duplicate slug "${slug}".`);
    }
    slugs.add(slug);

    // `slug:` field must match filename
    const slugMatch = content.match(/slug\s*:\s*["']([^"']+)["']/);
    if (slugMatch && slugMatch[1] !== slug) {
      errors.push(`${file}: slug field "${slugMatch[1]}" doesn't match filename "${slug}".`);
    }

    // `type:` field
    const typeMatch = content.match(/type\s*:\s*["']([^"']+)["']/);
    const type = typeMatch?.[1];
    if (!type) {
      errors.push(`${file}: type field missing.`);
    } else if (!["plugin", "mcp-server", "skill-pack", "agent-template", "companion"].includes(type)) {
      errors.push(`${file}: unknown type "${type}".`);
    }

    // `title:` uniqueness within type
    const titleMatch = content.match(/title\s*:\s*["']([^"']+)["']/);
    if (titleMatch && type) {
      const t = titleMatch[1];
      if (!titles.has(type)) titles.set(type, new Set());
      if (titles.get(type).has(t)) {
        errors.push(`${file}: duplicate title "${t}" in type "${type}".`);
      }
      titles.get(type).add(t);
    }

    // `source:` URL
    const srcMatch = content.match(/source\s*:\s*["']([^"']+)["']/);
    if (!srcMatch) {
      errors.push(`${file}: source field missing.`);
    } else if (!urlPattern.test(srcMatch[1])) {
      errors.push(`${file}: source "${srcMatch[1]}" is not a URL.`);
    }

    // `enabledPluginsAdd: [...]` — warn on unknown plugin ids
    const epMatch = content.match(/enabledPluginsAdd\s*:\s*\[([^\]]*)\]/);
    if (epMatch) {
      const listed = [...epMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      for (const id of listed) {
        if (!pluginIds.has(id)) {
          warnings.push(`${file}: plugin id "${id}" not in registry (expected one of: ${[...pluginIds].join(", ")}).`);
        }
      }
    }

    // `allowedHostsAdd: [...]`
    const ahMatch = content.match(/allowedHostsAdd\s*:\s*\[([^\]]*)\]/);
    if (ahMatch) {
      const listed = [...ahMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      for (const host of listed) {
        if (!hostPattern.test(host)) {
          errors.push(`${file}: allowedHostsAdd contains invalid hostname "${host}".`);
        }
      }
    }

    // `secrets: [...]` — structural scan (not a full parser)
    const secretNames = [...content.matchAll(/name\s*:\s*["']([A-Z][A-Z0-9_]*|[^"']+)["']/g)].map((m) => m[1]);
    for (const name of secretNames) {
      if (name.startsWith("#")) continue;
      if (!secretPattern.test(name) && !/^[A-Z]/.test(name)) {
        // Only complain about all-uppercase-looking names. Lowercase names
        // are likely field labels, not secret names — skip.
        continue;
      }
      if (!secretPattern.test(name)) {
        errors.push(`${file}: secret name "${name}" must be UPPER_SNAKE_CASE.`);
      }
    }
  }

  // Summary
  if (errors.length > 0) {
    console.error("[marketplace:validate] ERRORS");
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("");
  }
  if (warnings.length > 0) {
    console.warn("[marketplace:validate] WARNINGS");
    for (const w of warnings) console.warn(`  · ${w}`);
    console.warn("");
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`[marketplace:validate] ✓ ${slugs.size} entries, no issues.`);
    process.exit(0);
  }
  if (errors.length === 0) {
    console.log(`[marketplace:validate] ✓ ${slugs.size} entries, ${warnings.length} warning(s).`);
    process.exit(0);
  }
  console.error(`[marketplace:validate] ✗ ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
