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

/* ---------------- 3. read wrangler.toml for compat + bindings + migrations ---------------- */

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

/**
 * Parse every [[durable_objects.bindings]] block out of wrangler.toml.
 * The previous build hardcoded only AGENT_SESSIONS + STREAM_HUBS, so the
 * deployed Worker shipped without CHAT_SESSIONS / SHELL_CONTAINER /
 * SHELL_REGISTRY / CLI_AUTH bindings — chat WebSocket then 503'd with
 * E_DO_BINDING_MISSING because env.CHAT_SESSIONS was undefined.
 *
 * We also pull every [[migrations]] block so DO classes get registered
 * on the customer's Worker on the very first push.
 */
function parseTomlArrayTables(toml, header) {
  // Match each `[[<header>]]\n<keys>` chunk up to the next [[ table or [ table.
  const re = new RegExp(`\\[\\[${header.replace(".", "\\.")}\\]\\]([\\s\\S]*?)(?=\\n\\[|$)`, "g");
  const out = [];
  let m;
  while ((m = re.exec(toml)) !== null) {
    const block = {};
    for (const line of m[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const kv = /^([a-z_]+)\s*=\s*(.+)$/i.exec(trimmed);
      if (!kv) continue;
      const key = kv[1];
      let val = kv[2].trim();
      // Strip trailing inline comments
      if (val.includes("#") && !val.startsWith('"')) val = val.split("#")[0].trim();
      // Parse value: "string" | [array] | bare
      if (val.startsWith('"') && val.endsWith('"')) {
        block[key] = val.slice(1, -1);
      } else if (val.startsWith("[") && val.endsWith("]")) {
        block[key] = val.slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      } else if (val === "true" || val === "false") {
        block[key] = val === "true";
      } else if (/^-?\d+$/.test(val)) {
        block[key] = Number(val);
      } else {
        block[key] = val;
      }
    }
    out.push(block);
  }
  return out;
}

const doBindings = parseTomlArrayTables(wranglerToml, "durable_objects.bindings").map((b) => ({
  type: "durable_object_namespace",
  name: b.name,
  class_name: b.class_name
}));
const tomlMigrations = parseTomlArrayTables(wranglerToml, "migrations").map((m) => {
  const out = {};
  if (m.tag) out.tag = m.tag;
  if (Array.isArray(m.new_classes)) out.new_classes = m.new_classes;
  if (Array.isArray(m.new_sqlite_classes)) out.new_sqlite_classes = m.new_sqlite_classes;
  if (Array.isArray(m.deleted_classes)) out.deleted_classes = m.deleted_classes;
  if (Array.isArray(m.renamed_classes)) out.renamed_classes = m.renamed_classes;
  return out;
});

/**
 * Extract [[containers]] blocks from wrangler.toml and resolve each block's
 * `image` field into something CF's Workers Scripts API can pull on its own.
 *
 * Wrangler-local convention: `image = "./docker/shell/Dockerfile"`. Wrangler
 * builds the Dockerfile and pushes the resulting image to the customer's
 * account registry before the Worker upload. We can't build Dockerfiles
 * from a Worker, so we resolve the path: read the Dockerfile, parse the
 * `FROM` line, and emit the upstream registry reference (e.g.
 * `docker.io/cloudflare/sandbox:0.10.0`). CF's API accepts public registry
 * paths directly — no per-account image push required.
 *
 * Customizations (RUN/COPY/etc) below the FROM are dropped here. Customers
 * who need extra layers should run `wrangler deploy` locally with their own
 * fork of the Dockerfile; the cron path will then preserve their image
 * binding via mergeBindings (containers metadata is left intact when the
 * customer's existing script already has it).
 */
function resolveContainerImage(imageField) {
  if (!imageField || typeof imageField !== "string") return imageField;
  // Already a registry reference (no path separator, has a tag) → use as-is.
  if (!imageField.includes("/") || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(imageField)) {
    return imageField;
  }
  // Treat as a local Dockerfile path relative to the repo root.
  const dockerfilePath = resolve(root, imageField.replace(/^\.\//, ""));
  let dockerfileSrc;
  try {
    dockerfileSrc = readFileSync(dockerfilePath, "utf8");
  } catch (err) {
    console.warn(`[bundle] containers: cannot read Dockerfile at ${dockerfilePath} (${err.message}); falling back to raw image field`);
    return imageField;
  }
  // Match the first non-commented FROM line. Strip a leading `--platform=...`
  // flag and any AS clause.
  const fromMatch = /^\s*FROM\s+(?:--[^\s]+\s+)*([^\s]+)(?:\s+AS\s+\S+)?\s*$/im.exec(dockerfileSrc);
  if (!fromMatch) {
    console.warn(`[bundle] containers: no FROM line in ${dockerfilePath}; using raw image field`);
    return imageField;
  }
  return fromMatch[1];
}

const tomlContainers = parseTomlArrayTables(wranglerToml, "containers").map((c) => {
  const out = {};
  if (c.class_name) out.class_name = c.class_name;
  // Resolved image — see resolveContainerImage. Customer's CF account pulls
  // this directly from the upstream registry on first DO instantiation.
  if (c.image) out.image = resolveContainerImage(c.image);
  if (c.instance_type) out.instance_type = c.instance_type;
  if (typeof c.max_instances === "number") out.max_instances = c.max_instances;
  if (c.name) out.name = c.name;
  return out;
});

console.log(`[bundle] DO bindings from wrangler.toml: ${doBindings.length}`);
console.log(`[bundle] migrations from wrangler.toml: ${tomlMigrations.length}`);
console.log(`[bundle] containers   from wrangler.toml: ${tomlContainers.length}`);
for (const c of tomlContainers) {
  console.log(`[bundle]   container: class=${c.class_name} image=${c.image}`);
}

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
    // Abstract bindings — names + types only. Customer-specific IDs (D1
    // database_id, secret values) are layered on at push time by the
    // site Worker's runDeploy / pushUpdates which reads the customer's
    // existing script settings + merges. AI + every DO from wrangler.toml.
    bindings: [
      { type: "ai", name: "AI" },
      ...doBindings
    ],
    // Every migration from wrangler.toml. CF API expects the full ladder
    // — `flattenMigrationsForCfApi` collapses to `{ new_tag, new_classes,
    // new_sqlite_classes }` at upload time.
    migrations: tomlMigrations,
    // Containers tied to DO classes. Each entry binds a class_name (must
    // match a [[durable_objects.bindings]] class above) to a container
    // image CF will pull on first instantiation. Resolved at build time
    // from wrangler.toml's [[containers]] blocks — local Dockerfile
    // paths are flattened to their FROM image reference so customer
    // accounts pull directly from the upstream registry without needing
    // a local Docker daemon or per-account image push.
    containers: tomlContainers
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
console.log(`[bundle]   containers  = ${manifest.metadata.containers?.length ?? 0}`);
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
