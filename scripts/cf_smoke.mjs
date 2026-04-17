#!/usr/bin/env node

const workerUrlArg = process.argv[2] ?? process.env.WORKER_URL;
const listZones = process.argv.includes("--list-zones");

if (!workerUrlArg) {
  console.error("Usage: npm run cf:smoke -- <worker-url> [--list-zones]");
  console.error("Or set WORKER_URL in your environment.");
  process.exit(1);
}

const baseUrl = workerUrlArg.endsWith("/") ? workerUrlArg.slice(0, -1) : workerUrlArg;
const bearer = process.env.WORKER_BEARER_TOKEN;

function authHeaders() {
  if (!bearer) {
    return {};
  }

  return { Authorization: `Bearer ${bearer}` };
}

async function checkJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log(`Smoke testing worker: ${baseUrl}`);

  const health = await checkJson("/health");
  console.log("✅ /health", JSON.stringify(health));

  const plugins = await checkJson("/plugins");
  console.log("✅ /plugins", JSON.stringify(plugins));

  const skills = await checkJson("/skills");
  console.log("✅ /skills", JSON.stringify(skills));

  const introspect = await checkJson("/invoke/cloudflare-api-mcp", {
    method: "POST",
    body: JSON.stringify({ action: "introspect", input: { smoke: true } })
  });
  console.log("✅ /invoke/cloudflare-api-mcp (introspect)", JSON.stringify(introspect));

  if (listZones) {
    const zones = await checkJson("/invoke/cloudflare-api-mcp", {
      method: "POST",
      body: JSON.stringify({ action: "list-zones", input: {} })
    });
    console.log("✅ /invoke/cloudflare-api-mcp (list-zones)", JSON.stringify(zones));
  }
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
