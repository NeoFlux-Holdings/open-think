#!/usr/bin/env node
/**
 * Render src/app.ts's appHtml() locally + extract the inline <script> +
 * syntax-check it via node --check. Catches the "TS template literal
 * interprets \n in JS string" bug that broke /app twice already.
 *
 * Run: node scripts/check-app-html.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__dirname, "..");

// Use wrangler dry-run to compile + bundle src/app.ts → dist/, then read
// the bundled module and grep for the inline JS.
console.log("[check-app] running wrangler deploy --dry-run...");
const tmp = mkdtempSync(join(tmpdir(), "ot-check-app-"));
execSync(`npx wrangler deploy --dry-run --outdir="${tmp}" --minify=false`, {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"]
});

// Load the bundled module + invoke appHtml().
const fs = await import("node:fs");
const files = fs.readdirSync(tmp).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error("[check-app] no .js bundle in", tmp);
  process.exit(1);
}
const entry = join(tmp, files[0]);
console.log("[check-app] entry:", files[0]);

// We can't directly import the bundled worker (it's a Worker module), but
// we can read its text and find the appHtml return value's inline script.
// Simpler: just import src/app.ts via tsx if available, or render via
// running the worker locally.
//
// Easiest path: read src/app.ts directly + naively render the template.
// Since `appHtml()` is a pure function returning a template literal, we
// can just call it via dynamic import after compiling with esbuild on
// the fly.

const esbuild = await import("esbuild").catch(() => null);
if (!esbuild) {
  console.error("[check-app] esbuild not installed; install with `npm i -D esbuild`");
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [resolve(root, "src/app.ts")],
  bundle: false,
  write: false,
  format: "esm",
  target: "es2022",
  platform: "neutral"
});
const compiled = result.outputFiles[0].text;
const compiledPath = join(tmp, "app-compiled.mjs");
writeFileSync(compiledPath, compiled);

const mod = await import("file://" + compiledPath.replace(/\\/g, "/"));
const html = mod.appHtml();

// Extract the inline <script>.
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) {
  console.error("[check-app] couldn't find inline <script> in appHtml output");
  process.exit(1);
}
const js = m[1];
const jsPath = join(tmp, "app-inline.js");
writeFileSync(jsPath, js);
console.log(`[check-app] extracted ${js.length} chars of inline JS → ${jsPath}`);

// Syntax-check via node --check.
try {
  execSync(`node --check "${jsPath}"`, { stdio: "inherit" });
  console.log("[check-app] ✓ inline JS parses cleanly");
} catch {
  console.error("[check-app] ✗ inline JS has a syntax error (see output above)");
  process.exit(1);
}
