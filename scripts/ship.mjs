#!/usr/bin/env node
/**
 * Unified release script — bumps the version, tags + pushes the commit
 * (which triggers the GH Actions release-bundle workflow), and deploys
 * the marketing-site Worker.
 *
 * The two halves of "shipping" used to drift:
 *   - Bundle: published when a `v*` tag lands on origin → triggers
 *     .github/workflows/release-bundle.yml → uploads helm.mjs +
 *     manifest.json to GitHub Releases. Site Worker fetches from
 *     /releases/latest/ to push to subscribers.
 *   - Site:   `cd site && wrangler deploy` — independent.
 *
 * Drift mode: deploy form's defaults referenced plugins that the latest
 * published bundle didn't yet have, so every fresh deploy bricked with
 * E_PLUGIN_UNKNOWN until the user manually patched ENABLED_PLUGINS.
 *
 * This script ships both together so that combination is the default,
 * not the careful exception.
 *
 * Usage:
 *   npm run ship                      # interactive: prompts for version
 *   npm run ship -- --version v0.12.0 # explicit
 *   npm run ship -- --skip-bundle     # site-only redeploy (e.g. UI fix)
 *   npm run ship -- --skip-site       # bundle-only release
 *   npm run ship -- --dry-run         # print what would happen
 *
 * Pre-flight checks:
 *   - working tree clean (or --allow-dirty)
 *   - on main branch (or --allow-branch <name>)
 *   - up-to-date with origin/main
 *   - typecheck + tests pass (main + site)
 *
 * Steps:
 *   1. Confirm version
 *   2. Update package.json version (if changed)
 *   3. Commit version bump (if any)
 *   4. Create + push the v<version> tag → triggers GH Actions
 *   5. Print GH Actions URL so the user can watch the bundle build
 *   6. (in parallel with 5) deploy the site Worker
 *   7. Wait for the GH release to publish before declaring success
 *      (or skip this with --no-wait)
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");

/* ---------------- arg parsing ---------------- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const opts = {
  version: value("--version"),
  skipBundle: flag("--skip-bundle"),
  skipSite: flag("--skip-site"),
  skipChecks: flag("--skip-checks"),
  allowDirty: flag("--allow-dirty"),
  allowBranch: value("--allow-branch"),
  noWait: flag("--no-wait"),
  dryRun: flag("--dry-run"),
  help: flag("--help") || flag("-h")
};

if (opts.help) {
  console.log(`
Unified release: bumps version, tags, pushes (triggers bundle build), deploys site.

  npm run ship                       interactive
  npm run ship -- --version v0.12.0  explicit version
  npm run ship -- --skip-bundle      site-only redeploy
  npm run ship -- --skip-site        bundle-only release
  npm run ship -- --skip-checks      skip typecheck + tests
  npm run ship -- --allow-dirty      ship with uncommitted changes
  npm run ship -- --allow-branch X   ship from branch X (default main)
  npm run ship -- --no-wait          don't wait for GH release after push
  npm run ship -- --dry-run          print what would happen, do nothing
  npm run ship -- --help             this message
`);
  process.exit(0);
}

/* ---------------- helpers ---------------- */

// In dry-run mode we still RUN read-only commands (so pre-flight checks
// produce real values); we only stub WRITES. Pass `write: true` for
// commands that would mutate state (commit, tag, push, deploy, write
// files).
function run(cmd, options = {}) {
  const { write, ...rest } = options;
  if (opts.dryRun && write) {
    console.log(`[dry-run] $ ${cmd}`);
    return "";
  }
  return execSync(cmd, { cwd: root, encoding: "utf8", ...rest }).trim();
}

function runStream(cmd, args, options = {}) {
  const { write, ...rest } = options;
  if (opts.dryRun && write) {
    console.log(`[dry-run] $ ${cmd} ${args.join(" ")}`);
    return 0;
  }
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...rest });
  return r.status ?? 1;
}

function header(s) {
  console.log("");
  console.log(`\x1b[1m\x1b[36m── ${s}\x1b[0m`);
}

function note(s) {
  console.log(`\x1b[2m   ${s}\x1b[0m`);
}

function ok(s) {
  console.log(`\x1b[32m   ✓\x1b[0m ${s}`);
}

function fail(s) {
  console.error(`\x1b[31m   ✗\x1b[0m ${s}`);
}

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

function bumpType(arg) {
  return ["patch", "minor", "major"].includes(arg) ? arg : null;
}

function semverBump(current, kind) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error(`unparseable version: ${current}`);
  const [, maj, min, pat] = m;
  if (kind === "major") return `${Number(maj) + 1}.0.0`;
  if (kind === "minor") return `${maj}.${Number(min) + 1}.0`;
  return `${maj}.${min}.${Number(pat) + 1}`;
}

/* ---------------- pre-flight ---------------- */

header("Pre-flight");

// 1. Branch check
const branch = run("git rev-parse --abbrev-ref HEAD");
const expectedBranch = opts.allowBranch ?? "main";
if (branch !== expectedBranch) {
  fail(`on branch ${branch}, expected ${expectedBranch} (use --allow-branch to override)`);
  process.exit(1);
}
ok(`branch: ${branch}`);

// 2. Dirty tree check
const dirty = run("git status --porcelain");
if (dirty && !opts.allowDirty) {
  fail("working tree has uncommitted changes:");
  console.error(dirty);
  fail("commit or stash first (or --allow-dirty if you know what you're doing)");
  process.exit(1);
}
ok(dirty ? `working tree dirty (--allow-dirty)` : "working tree clean");

// 3. Up-to-date check
try {
  run("git fetch origin --quiet");
  const local = run("git rev-parse HEAD");
  const remote = run(`git rev-parse origin/${branch}`);
  if (local !== remote) {
    fail(`local ${branch} is not in sync with origin/${branch}`);
    fail(`local:  ${local.slice(0, 12)}`);
    fail(`remote: ${remote.slice(0, 12)}`);
    fail(`pull/push to align, then re-run`);
    process.exit(1);
  }
  ok(`up-to-date with origin/${branch}`);
} catch (err) {
  note(`git fetch failed (${err.message}) — skipping up-to-date check`);
}

// 4. Resolve version
header("Version");

const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const currentVersion = pkg.version;
note(`current package.json version: ${currentVersion}`);

let nextVersion = opts.version ?? "";
if (!nextVersion) {
  const choice = await ask(
    `Next version? Type semver (1.2.3 or v1.2.3), bump kind (patch/minor/major), or "" to keep ${currentVersion}: `
  );
  if (!choice) {
    nextVersion = currentVersion;
  } else if (bumpType(choice)) {
    nextVersion = semverBump(currentVersion, choice);
  } else {
    nextVersion = choice.replace(/^v/, "");
  }
}
nextVersion = nextVersion.replace(/^v/, "");
const tag = `v${nextVersion}`;
ok(`shipping ${tag} (current: ${currentVersion})`);

// 5. Run typecheck + tests
if (!opts.skipChecks) {
  header("Checks");
  if (runStream("npm", ["run", "typecheck"]) !== 0) {
    fail("main typecheck failed");
    process.exit(1);
  }
  ok("main typecheck");

  if (runStream("npm", ["run", "test", "--", "--run"]) !== 0) {
    fail("main tests failed");
    process.exit(1);
  }
  ok("main tests");

  if (runStream("npm", ["run", "check:app"]) !== 0) {
    fail("check:app failed");
    process.exit(1);
  }
  ok("check:app");

  if (runStream("npx", ["tsc", "--noEmit"], { cwd: resolve(root, "site") }) !== 0) {
    fail("site typecheck failed");
    process.exit(1);
  }
  ok("site typecheck");

  if (runStream("npm", ["test", "--", "--run"], { cwd: resolve(root, "site") }) !== 0) {
    fail("site tests failed");
    process.exit(1);
  }
  ok("site tests");
} else {
  note("skipping checks (--skip-checks)");
}

// 6. Commit version bump if needed
if (nextVersion !== currentVersion) {
  header("Version bump");
  pkg.version = nextVersion;
  if (!opts.dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } else {
    console.log(`[dry-run] would write package.json version ${nextVersion}`);
  }
  run(`git add package.json`, { write: true });
  run(`git commit -m "chore: bump version to ${tag}"`, { write: true });
  ok(`version bumped + committed`);
}

/* ---------------- bundle release ---------------- */

if (!opts.skipBundle) {
  header(`Bundle release (${tag})`);
  // Tag-driven: pushing the tag triggers
  // .github/workflows/release-bundle.yml which builds + uploads.
  try {
    run(`git tag ${tag}`, { write: true });
    ok(`tag ${tag} created`);
  } catch (err) {
    if (/already exists/i.test(err.message)) {
      note(`tag ${tag} already exists — re-pushing`);
    } else {
      throw err;
    }
  }
  run(`git push origin ${branch}`, { write: true });
  ok(`pushed ${branch}`);
  run(`git push origin ${tag}`, { write: true });
  ok(`pushed tag ${tag}`);

  // Find the GH repo URL so we can print a click-to-watch link.
  let repoUrl = "";
  try {
    const remote = run(`git remote get-url origin`);
    const m = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (m) repoUrl = `https://github.com/${m[1]}`;
  } catch {/* noop */}
  if (repoUrl) {
    note(`watch the build: ${repoUrl}/actions/workflows/release-bundle.yml`);
    note(`release page:    ${repoUrl}/releases/tag/${tag}`);
  }
} else {
  note("skipping bundle release (--skip-bundle)");
}

/* ---------------- site deploy ---------------- */

if (!opts.skipSite) {
  header("Site Worker deploy");
  const r = runStream("npm", ["run", "deploy"], { cwd: resolve(root, "site"), write: true });
  if (r !== 0) {
    fail("site deploy failed");
    process.exit(1);
  }
  ok("site deployed");
} else {
  note("skipping site deploy (--skip-site)");
}

/* ---------------- summary ---------------- */

header("Done");
ok(`shipped ${tag}`);
if (!opts.skipBundle) {
  note("GH Actions is building the bundle in the background. The deploy form");
  note("will pick it up automatically once /releases/latest/manifest.json updates");
  note("(usually 2-3 minutes).");
}
note("");
note("Test it by visiting your /deploy/cloud and running through a deploy —");
note("the new manifest's `plugins[]` field will intersect with the form's");
note("ENABLED_PLUGINS default so v0.10-bundle-on-v0.11-config skew can't brick");
note("future deploys.");
