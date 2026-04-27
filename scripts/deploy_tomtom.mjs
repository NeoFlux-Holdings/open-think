#!/usr/bin/env node
/**
 * One-shot deploy helper for Tom-Tom (or any personal fork of this runtime).
 *
 *   - Checks wrangler auth
 *   - Prompts for optional secrets (Anthropic key, Cloudflare API token, MCP URL, personal context)
 *   - Runs wrangler deploy
 *   - Prints the worker URL and the /app route
 *
 * Usage: node scripts/deploy_tomtom.mjs
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));
const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;

function wrangler(args, opts = {}) {
  const r = spawnSync("npx", ["--yes", "wrangler", ...args], {
    stdio: opts.capture ? "pipe" : "inherit",
    shell: process.platform === "win32",
    ...opts
  });
  return {
    status: r.status,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? ""
  };
}

async function yes(prompt, defaultYes = false) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const ans = (await ask(`${prompt} ${suffix}: `)).trim().toLowerCase();
  if (ans === "") return defaultYes;
  return ans.startsWith("y");
}

async function main() {
  console.log(bold("\nTom-Tom · Cloudflare Worker deploy\n"));

  // 1. Check login
  const check = wrangler(["whoami"], { capture: true });
  if (check.status !== 0 || /not authenticated|You are not|not logged in/i.test(check.stdout + check.stderr)) {
    console.log(dim("→ wrangler is not authenticated; launching login flow"));
    wrangler(["login"]);
  } else {
    console.log(dim(check.stdout.split("\n").slice(0, 4).join("\n")));
  }

  // 2. Optional secrets (one question per secret)
  if (await yes("Set ANTHROPIC_API_KEY now? (unlocks native tool-use streaming)", false)) {
    wrangler(["secret", "put", "ANTHROPIC_API_KEY"]);
  }

  if (await yes("Set CLOUDFLARE_API_TOKEN now? (unlocks the cloudflare-api-mcp plugin)", false)) {
    wrangler(["secret", "put", "CLOUDFLARE_API_TOKEN"]);
  }

  if (await yes("Point MCP client at https://mcp.cloudflare.com/mcp? (chat-driven account ops)", true)) {
    wrangler(["secret", "put", "MCP_DEFAULT_URL"]);
    if (await yes("Also set MCP_BEARER_TOKEN (same scope as CLOUDFLARE_API_TOKEN usually)?", false)) {
      wrangler(["secret", "put", "MCP_BEARER_TOKEN"]);
    }
  }

  if (await yes("Add PERSONAL_CONTEXT (free-form text Tom-Tom uses as standing context)?", false)) {
    wrangler(["secret", "put", "PERSONAL_CONTEXT"]);
  }

  // 3. Deploy
  console.log(bold("\nDeploying tom-tom…\n"));
  const deploy = wrangler(["deploy"]);
  if (deploy.status !== 0) {
    console.error(bold("✗ wrangler deploy failed"));
    rl.close();
    process.exit(deploy.status ?? 1);
  }

  console.log(bold("\n✓ deployed"));
  console.log("Next:");
  console.log("  • Open https://tom-tom.<your-subdomain>.workers.dev/app");
  console.log("  • Or run: npm run cf:smoke -- https://tom-tom.<your-subdomain>.workers.dev");
  console.log("  • Settings tab (g t) runs guided setup with the Cloudflare MCP");
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
