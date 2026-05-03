#!/usr/bin/env node
/**
 * Helm Cloud bundle pipeline — produces `dist/helm.mjs` + `dist/manifest.json`.
 *
 * The marketing-site Worker's hourly cron fetches `manifest.json`, follows
 * `manifest.moduleUrl` to the bundle bytes, and pushes them to every active
 * subscriber's Worker via the Cloudflare Workers API.
 *
 * Inputs (env vars, all optional):
 *   GITHUB_REPOSITORY   — owner/repo, e.g. NeoFlux-Holdings/open-think (default below)
 *   RELEASE_VERSION     — human tag, e.g. v0.4.0 (default = git sha)
 *   MODULE_URL          — override the moduleUrl in the manifest. Default is
 *                         the GitHub Releases "latest" URL pattern.
 *   OUT_DIR             — output directory (default `dist`)
 *
 * Outputs:
 *   dist/helm.mjs       — minified, single-file ESM bundle of the runtime
 *   dist/manifest.json  — manifest the cron consumes
 *
 * The manifest's `metadata` field is the abstract bindings shape the bundle
 * expects — DO classes, AI, etc. Customer-specific bindings (D1 ID, secrets)
 * are layered on at push time by `site/src/cloud/pushUpdates.ts`. (TODO:
 * the current pushUpdates overwrites all bindings; before flipping the
 * managed-deploy switch publicly, it must read the existing script's
 * bindings via GET /workers/scripts/{name} and merge them with this
 * manifest's abstract bindings so customers' D1 + secrets survive.)
 */

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");
const out = resolve(root, process.env.OUT_DIR ?? "dist");
mkdirSync(out, { recursive: true });

console.log(`[bundle] root=${root}`);
console.log(`[bundle] out=${out}`);

/* ---------------- 1. dry-run wrangler to produce the bundle ---------------- */

console.log("[bundle] running wrangler deploy --dry-run --outdir=dist…");
execSync(`npx wrangler deploy --dry-run --outdir="${out}" --minify`, {
  cwd: root,
  stdio: "inherit"
});

// wrangler emits the bundle as <entry-basename>.js — `main = "src/index.ts"`
// produces `dist/index.js`. Detect the actual file rather than hard-coding.
const candidates = ["index.js", "_worker.js", "main.js"];
let entryFile = candidates.find((f) => existsSync(resolve(out, f)));
if (!entryFile) {
  // Last-resort: scan the dir for any .js
  const fs = await import("node:fs");
  const files = fs.readdirSync(out).filter((f) => f.endsWith(".js") && !f.endsWith(".map"));
  if (files.length === 0) {
    console.error(`[bundle] no .js file in ${out} — wrangler dry-run failed`);
    process.exit(1);
  }
  entryFile = files[0];
}
console.log(`[bundle] entry: ${entryFile}`);
const entryPath = resolve(out, entryFile);
const moduleBytes = readFileSync(entryPath);
const moduleSize = statSync(entryPath).size;

/* ---------------- 2. compute sha + git context ---------------- */

const sha = createHash("sha256").update(moduleBytes).digest("hex").slice(0, 16);

let gitSha = "unknown";
try {
  gitSha = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
} catch {
  /* not a git checkout */
}

const repo = process.env.GITHUB_REPOSITORY ?? "NeoFlux-Holdings/open-think";
const version = process.env.RELEASE_VERSION ?? gitSha.slice(0, 12);
const moduleUrl =
  process.env.MODULE_URL ??
  `https://github.com/${repo}/releases/latest/download/helm.mjs`;

/* ---------------- 3. read wrangler.toml for compat date + flags ---------------- */

const wranglerToml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const compatibilityDate = matchOne(
  wranglerToml,
  /^compatibility_date\s*=\s*"([^"]+)"/m,
  "2026-04-16"
);
const compatibilityFlagsRaw = matchOne(
  wranglerToml,
  /^compatibility_flags\s*=\s*\[([^\]]*)\]/m,
  '"nodejs_compat_v2"'
);
const compatibilityFlags = compatibilityFlagsRaw
  .split(",")
  .map((s) => s.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);

/* ---------------- 3.5. extract the plugin id list ---------------- */
// Scan src/plugins/*.ts for `readonly id = "..."` declarations so the
// deploy form can intersect its ENABLED_PLUGINS default with what the
// bundle actually ships. Without this, an older bundle + newer
// ENABLED_PLUGINS default = E_PLUGIN_UNKNOWN on bootstrap.

const pluginsDir = resolve(root, "src/plugins");
const pluginIds = [];
try {
  const files = readdirSync(pluginsDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "registry.ts"
  );
  for (const file of files) {
    const src = readFileSync(resolve(pluginsDir, file), "utf8");
    // Match `readonly id = "<id>"` (the conventional plugin-id declaration).
    // Uses string literal — no template-literal/computed shenanigans expected.
    const m = /readonly\s+id\s*=\s*["']([a-z0-9-]+)["']/.exec(src);
    if (m) pluginIds.push(m[1]);
  }
  pluginIds.sort();
} catch (err) {
  console.warn(`[bundle] plugin-id scan failed (${err.message}) — manifest will omit plugins[]`);
}

/* ---------------- 4. assemble the manifest ---------------- */

const manifest = {
  sha,
  version,
  builtAt: new Date().toISOString(),
  gitSha,
  moduleUrl,
  moduleSize,
  // Plugin ids the runtime bundle ships with. The deploy form
  // intersects this with its ENABLED_PLUGINS default so a v0.10 bundle
  // doesn't get told to enable a v0.11-only plugin (which would throw
  // E_PLUGIN_UNKNOWN on older bundles that don't have the runtime
  // tolerance fix).
  plugins: pluginIds,
  metadata: {
    // Modules format — Workers API key for the entry module name.
    main_module: "helm.mjs",
    compatibility_date: compatibilityDate,
    compatibility_flags: compatibilityFlags,
    // Abstract bindings — names + types only. The push step preserves the
    // customer's existing IDs (D1, secrets) by reading their script's
    // current metadata before pushing.
    bindings: [
      { type: "ai", name: "AI" },
      {
        type: "durable_object_namespace",
        name: "AGENT_SESSIONS",
        class_name: "AgentSessionDO"
      },
      {
        type: "durable_object_namespace",
        name: "STREAM_HUBS",
        class_name: "StreamHubDO"
      }
    ],
    migrations: [
      { tag: "v1", new_sqlite_classes: ["AgentSessionDO"] },
      { tag: "v2", new_classes: ["StreamHubDO"] }
    ]
  }
};

/* ---------------- 5. write helm.mjs + manifest.json ---------------- */

const helmPath = resolve(out, "helm.mjs");
copyFileSync(entryPath, helmPath);

const manifestPath = resolve(out, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

/* ---------------- 6. summarize ---------------- */

console.log("");
console.log(`[bundle] ✓ helm.mjs       ${formatBytes(moduleSize)}  sha=${sha}`);
console.log(`[bundle] ✓ manifest.json  version=${version}`);
console.log(`[bundle]   moduleUrl   = ${moduleUrl}`);
console.log(`[bundle]   bindings    = ${manifest.metadata.bindings.length}`);
console.log(`[bundle]   migrations  = ${manifest.metadata.migrations?.length ?? 0}`);
console.log(`[bundle]   plugins     = ${manifest.plugins.length} (${manifest.plugins.slice(0, 4).join(",")}${manifest.plugins.length > 4 ? ", …" : ""})`);
console.log("");
console.log("[bundle] release artifacts ready under " + out);

/* ---------------- helpers ---------------- */

function matchOne(s, re, fallback) {
  const m = s.match(re);
  return m ? m[1] : fallback;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
