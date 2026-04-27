#!/usr/bin/env node
/**
 * Open Think PA wizard — one-shot setup for the personal-assistant stack.
 *
 *   npm run pa:setup
 *
 * Walks the operator through every step that wrangler's "Deploy to Workers"
 * button can't automate:
 *
 *   1. Create the D1 database + paste the id into wrangler.toml
 *   2. Generate VAPID keys + set the three Web Push secrets
 *   3. Prompt for OWNER_EMAIL / FROM_EMAIL / VAPID_SUBJECT and set them
 *   4. Print the manual dashboard steps that need a human:
 *        - Cloudflare Access app (Zero Trust → Access → Applications)
 *        - Email Routing on your sender domain
 *        - Stripe (only if you also want the marketing-site payments)
 *   5. Optionally run `wrangler deploy` and seed the morning-briefing
 *      workflow row.
 *
 * Idempotent: re-runnable. Anything already configured is skipped with a
 * one-line note. Anything missing is offered.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const WRANGLER_PATH = join(REPO_ROOT, "wrangler.toml");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function wrangler(args, opts = {}) {
  return spawnSync("npx", ["--yes", "wrangler", ...args], {
    stdio: opts.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

async function yes(prompt, defaultYes = true) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await ask(`${prompt} ${suffix} `)).trim().toLowerCase();
  if (a === "") return defaultYes;
  return a.startsWith("y");
}

async function nonEmpty(prompt) {
  for (;;) {
    const a = (await ask(prompt)).trim();
    if (a) return a;
    console.log(yellow("  (required)"));
  }
}

function readWrangler() {
  return readFileSync(WRANGLER_PATH, "utf8");
}

function patchWrangler(patcher) {
  const before = readWrangler();
  const after = patcher(before);
  if (before === after) return false;
  writeFileSync(WRANGLER_PATH, after, "utf8");
  return true;
}

function alreadyHasD1Id() {
  const text = readWrangler();
  // Detects a real-looking UUID; rejects "<fill-after-...>" placeholder.
  const m = text.match(/database_id\s*=\s*"([^"]+)"/);
  return Boolean(m && /^[0-9a-f-]{20,}$/i.test(m[1]));
}

async function step_d1() {
  console.log(bold("\n[1/5] D1 database"));
  if (alreadyHasD1Id()) {
    console.log(green("  ✓ wrangler.toml already has a D1 database_id — skipping create."));
    return;
  }
  if (!(await yes("Create a new D1 database 'tom-tom-pa' now?"))) return;

  const r = wrangler(["d1", "create", "tom-tom-pa"], { capture: true });
  const stdout = r.stdout ?? "";
  if (r.stderr) console.error(dim(r.stderr));
  console.log(stdout);
  const idMatch = stdout.match(/database_id\s*=\s*"([0-9a-f-]+)"/i);
  if (!idMatch) {
    console.log(yellow("  Couldn't auto-detect the database_id — copy it from the output above into wrangler.toml manually."));
    return;
  }
  const dbId = idMatch[1];
  const patched = patchWrangler((src) =>
    src.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${dbId}"`)
  );
  console.log(patched ? green(`  ✓ wrangler.toml patched with database_id=${dbId}`) : yellow("  Couldn't patch wrangler.toml automatically; paste the id yourself."));
}

async function step_vapid() {
  console.log(bold("\n[2/5] VAPID keys (Web Push)"));
  if (!(await yes("Generate new VAPID keys + set the three secrets?"))) return;

  const r = spawnSync("node", ["scripts/generate_vapid_keys.mjs"], {
    stdio: "pipe",
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  const out = r.stdout ?? "";
  process.stdout.write(out);
  if (r.stderr) console.error(dim(r.stderr));

  const pubMatch = out.match(/VAPID_PUBLIC_KEY=([\w-]+)/);
  const privMatch = out.match(/VAPID_PRIVATE_KEY=([\w-]+)/);
  if (!pubMatch || !privMatch) {
    console.log(yellow("  Couldn't capture the keys from generator output."));
    return;
  }

  if (await yes("Pipe these keys into `wrangler secret put` now?", true)) {
    spawnSync("npx", ["--yes", "wrangler", "secret", "put", "VAPID_PUBLIC_KEY"], {
      input: pubMatch[1] + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
      cwd: REPO_ROOT
    });
    spawnSync("npx", ["--yes", "wrangler", "secret", "put", "VAPID_PRIVATE_KEY"], {
      input: privMatch[1] + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
      cwd: REPO_ROOT
    });
    const subj = await nonEmpty("  VAPID_SUBJECT (e.g. mailto:you@example.com): ");
    spawnSync("npx", ["--yes", "wrangler", "secret", "put", "VAPID_SUBJECT"], {
      input: subj + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
      cwd: REPO_ROOT
    });
    console.log(green("  ✓ VAPID secrets uploaded."));
  } else {
    console.log(dim("  Save the keys somewhere safe and run the secret commands when ready."));
  }
}

async function step_owner_email() {
  console.log(bold("\n[3/5] Owner identity"));
  if (!(await yes("Set OWNER_EMAIL + FROM_EMAIL + DEFAULT_TIMEZONE in wrangler.toml [vars]?"))) return;

  const owner = await nonEmpty("  OWNER_EMAIL (the inbox PA notifications go to): ");
  const from = (await ask("  FROM_EMAIL (default: helm@your-domain — leave blank to skip): ")).trim();
  const tz = (await ask("  DEFAULT_TIMEZONE (e.g. America/New_York — leave blank to skip): ")).trim();

  patchWrangler((src) => {
    let next = src;
    next = ensureVar(next, "OWNER_EMAIL", owner);
    if (from) next = ensureVar(next, "FROM_EMAIL", from);
    if (tz) next = ensureVar(next, "DEFAULT_TIMEZONE", tz);
    return next;
  });
  console.log(green("  ✓ wrangler.toml [vars] updated."));
}

function ensureVar(toml, name, value) {
  const re = new RegExp(`^${name}\\s*=\\s*"[^"]*"`, "m");
  if (re.test(toml)) return toml.replace(re, `${name} = "${value}"`);
  // Insert after the existing AGENT_OWNER line (always present in our wrangler.toml).
  return toml.replace(
    /^AGENT_OWNER\s*=\s*"[^"]*"\s*$/m,
    (m) => `${m}\n${name} = "${value}"`
  );
}

async function step_access_reminder() {
  console.log(bold("\n[4/5] Cloudflare Access (manual dashboard step)"));
  console.log(`  ${cyan("→")} dash.cloudflare.com → Zero Trust → Access → Applications → Add an application`);
  console.log("    Type: Self-hosted");
  console.log("    Application domain: <your worker URL or custom hostname>");
  console.log("    Identity provider: One-Time PIN (free, no IdP setup)");
  console.log("    Policy: Include emails → your email");
  console.log("");
  if (await yes("Have you got the AUD tag + Team domain copy-pasted?")) {
    const aud = await nonEmpty("  CF_ACCESS_AUD: ");
    const team = await nonEmpty("  CF_ACCESS_TEAM_DOMAIN (e.g. https://yourname.cloudflareaccess.com): ");
    spawnSync("npx", ["--yes", "wrangler", "secret", "put", "CF_ACCESS_AUD"], {
      input: aud + "\n",
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
      cwd: REPO_ROOT
    });
    patchWrangler((src) => ensureVar(src, "CF_ACCESS_TEAM_DOMAIN", team));
    console.log(green("  ✓ Access wiring done."));
  } else {
    console.log(yellow("  Skipping. Without Access, your /app + /conductor/* are unauthenticated."));
  }
}

async function step_email_routing() {
  console.log(bold("\n[5/5] Email Routing (manual dashboard step)"));
  console.log(`  ${cyan("→")} dash.cloudflare.com → Email → Email Routing → enable on your domain`);
  console.log("    Add a verified destination address (your inbox)");
  console.log("    Routes → Catch-all → Send to Worker → pick this Worker (open-think / tom-tom)");
  console.log("");
  console.log(dim("  No env changes needed — the email() handler in src/index.ts handles inbound."));
}

async function step_deploy() {
  console.log(bold("\nReady to deploy"));
  if (await yes("Run `wrangler deploy` now?", true)) {
    wrangler(["deploy"]);
    console.log("");
    if (await yes("Seed the morning-briefing workflow row (POST /scheduler/workflows)?", true)) {
      console.log(
        dim(
          "  Manual step (you'll need an Access JWT cookie to hit /scheduler/workflows):\n" +
            "    curl -X POST https://<your-worker>/scheduler/workflows \\\n" +
            "      -H 'cf-access-jwt-assertion: <token>' \\\n" +
            "      -H 'content-type: application/json' \\\n" +
            "      -d '{\"name\":\"daily brief\",\"cron\":\"55 12 * * *\",\"handler\":\"morning-briefing\"}'"
        )
      );
    }
  }
}

async function main() {
  console.log(bold("Open Think :: Personal-assistant setup wizard"));
  console.log(dim("  Resumable — anything you skip you can re-run later.\n"));

  if (!existsSync(WRANGLER_PATH)) {
    console.error(yellow(`Couldn't find ${WRANGLER_PATH}. Are you in the repo root?`));
    process.exit(1);
  }

  await step_d1();
  await step_vapid();
  await step_owner_email();
  await step_access_reminder();
  await step_email_routing();
  await step_deploy();

  console.log(bold(green("\nDone. ")) + dim("Visit /app to chat with Helm; /setup/status to see what's still missing."));
  rl.close();
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  rl.close();
  process.exit(1);
});
