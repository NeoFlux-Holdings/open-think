#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function bold(s) {
  return `\u001b[1m${s}\u001b[0m`;
}

function wrangler(args, { capture } = { capture: false }) {
  const result = spawnSync("npx", ["--yes", "wrangler", ...args], {
    stdio: capture ? "pipe" : "inherit",
    shell: process.platform === "win32"
  });
  if (capture) {
    return {
      status: result.status,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? ""
    };
  }
  return { status: result.status };
}

function writeDevVarsTemplate() {
  const target = ".dev.vars";
  const example = ".dev.vars.example";
  if (existsSync(target)) {
    return { created: false, path: target };
  }
  if (!existsSync(example)) {
    return { created: false, path: target };
  }
  writeFileSync(target, readFileSync(example, "utf8"), "utf8");
  return { created: true, path: target };
}

async function yes(prompt, defaultYes = true) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await ask(`${prompt} ${suffix}: `)).trim().toLowerCase();
  if (answer === "") {
    return defaultYes;
  }
  return answer.startsWith("y");
}

async function main() {
  console.log(bold("Open Think :: Cloudflare bootstrap wizard"));
  console.log("This will:");
  console.log("  1. Create a local .dev.vars from the template (if missing)");
  console.log("  2. Prompt for any Cloudflare secrets you want to set via wrangler");
  console.log("  3. Optionally run wrangler deploy\n");

  const devVars = writeDevVarsTemplate();
  if (devVars.created) {
    console.log(`✓ Created ${devVars.path} (edit this for local dev)\n`);
  } else {
    console.log(`• ${devVars.path} already exists (skipping template copy)\n`);
  }

  if (await yes("Authenticate wrangler now? (npx wrangler login)", false)) {
    wrangler(["login"]);
  }

  console.log("");
  console.log("Cloudflare token: prefer a scoped API token over a global key.");
  if (await yes("Set CLOUDFLARE_API_TOKEN secret now?", true)) {
    wrangler(["secret", "put", "CLOUDFLARE_API_TOKEN"]);
  } else if (await yes("Set CLOUDFLARE_AGENT_TOKEN secret instead?", false)) {
    wrangler(["secret", "put", "CLOUDFLARE_AGENT_TOKEN"]);
  }

  if (await yes("Enable and configure the optional mpp plugin now?", false)) {
    wrangler(["secret", "put", "MPP_API_KEY"]);
  }

  if (await yes("Configure an outbound MCP server (MCP_DEFAULT_URL + optional MCP_BEARER_TOKEN)?", false)) {
    wrangler(["secret", "put", "MCP_DEFAULT_URL"]);
    if (await yes("Also set MCP_BEARER_TOKEN?", false)) {
      wrangler(["secret", "put", "MCP_BEARER_TOKEN"]);
    }
  }

  if (await yes("Set AI_GATEWAY_ID (route Workers AI through AI Gateway)?", false)) {
    wrangler(["secret", "put", "AI_GATEWAY_ID"]);
  }

  /* ---------------- PA stack ---------------- */
  console.log("");
  console.log(bold("Personal-assistant stack (auth, memory, email, push, scheduling)"));
  console.log("  Skip this section if you only want the bare runtime.\n");

  if (await yes("Set up the full PA stack (run `npm run pa:setup`)?", false)) {
    rl.close();
    spawnSync("node", ["scripts/pa_setup.mjs"], { stdio: "inherit" });
    return;
  }

  if (await yes("Set CF_ACCESS_AUD (Application AUD tag from Zero Trust → Access)?", false)) {
    wrangler(["secret", "put", "CF_ACCESS_AUD"]);
  }
  if (await yes("Generate + set VAPID keys for Web Push?", false)) {
    spawnSync("node", ["scripts/generate_vapid_keys.mjs"], { stdio: "inherit" });
    if (await yes("Pipe the keys into `wrangler secret put` now?", true)) {
      wrangler(["secret", "put", "VAPID_PUBLIC_KEY"]);
      wrangler(["secret", "put", "VAPID_PRIVATE_KEY"]);
      wrangler(["secret", "put", "VAPID_SUBJECT"]);
    }
  }
  if (await yes("Create a D1 database for the PA tables (`wrangler d1 create tom-tom-pa`)?", false)) {
    const r = wrangler(["d1", "create", "tom-tom-pa"], { capture: true });
    console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    console.log(
      "  ↑ Copy the database_id into wrangler.toml under [[d1_databases]] before redeploying."
    );
  }

  console.log("");
  if (await yes("Run `wrangler deploy` now?", true)) {
    wrangler(["deploy"]);
  }

  console.log("");
  console.log(bold("Next steps:"));
  console.log("  • Confirm ENABLED_PLUGINS / ALLOWED_HOSTS in wrangler.toml");
  console.log("  • Smoke test: npm run cf:smoke -- https://<your-worker-url>");
  console.log("  • Try the playground: https://<your-worker-url>/playground");
  console.log("  • PA stack: docs/PA_STACK.md");
  console.log("  • Email Routing setup: dash → Email → Email Routing (manual, one-time)");
  console.log("  • Cloudflare Access app: dash → Zero Trust → Access (manual, one-time)");
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
