#!/usr/bin/env node
/**
 * Helm Shell CLI — terminal client for /shell/ws.
 *
 * Two auth paths:
 *   1. Device-code login (default, recommended for humans)
 *      First run prints a URL + short code; you open it in a browser
 *      (Cloudflare Access gates the page so it knows who you are),
 *      click "Approve". CLI polls and saves the bearer to
 *      ~/.config/open-think/auth-<host>.json. Subsequent runs use it.
 *   2. Service-token / raw JWT (for ops + CI)
 *      Pass --service-token-id/--service-token-secret OR --cf-access-jwt.
 *
 * Usage:
 *   npm run shell -- --host helm.your-domain.workers.dev
 *   npm run shell -- --host localhost:8787 --insecure          # local dev
 *   npm run shell -- --host helm.example --logout               # forget cached bearer
 *   npm run shell -- --host helm.example --print-token          # show stored bearer
 *
 * Frame protocol (1-byte opcode + payload):
 *   client → server: i + bytes (stdin), r + JSON (resize), p (ping), S + name (signal)
 *   server → client: o + bytes (stdout), e + msg (exit), P (pong), m + bytes (motd), E + bytes (error)
 *
 * See docker/shell/server.mjs for the bridge implementation.
 */
import { WebSocket } from "ws";
import { argv, env, exit, stdin, stdout, stderr } from "node:process";
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

function readArgs() {
  const { values } = parseArgs({
    args: argv.slice(2),
    strict: false,
    options: {
      host: { type: "string", default: env.HELM_HOST ?? undefined },
      session: { type: "string" },
      "service-token-id": { type: "string" },
      "service-token-secret": { type: "string" },
      "cf-access-jwt": { type: "string", default: env.CF_ACCESS_JWT ?? undefined },
      bearer: { type: "string" },
      insecure: { type: "boolean", default: false },
      logout: { type: "boolean", default: false },
      "print-token": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" }
    }
  });
  return values;
}

function usage() {
  stdout.write([
    "open-think-shell — terminal client for the Helm Shell container",
    "",
    "USAGE",
    "  npm run shell -- --host <host> [options]",
    "",
    "AUTH (auto, in order):",
    "  1. --bearer <cli_xxx>          explicit bearer (skips device-code flow)",
    "  2. --service-token-id/secret   CF Access service tokens (CI/ops)",
    "  3. --cf-access-jwt <jwt>       raw JWT (CF-Access-Jwt-Assertion)",
    "  4. cached bearer at ~/.config/open-think/auth-<host>.json",
    "  5. device-code login (default; opens approval URL in browser)",
    "",
    "OPTIONS",
    "  --host <host>                  e.g. helm.example.workers.dev (or HELM_HOST)",
    "  --session <name>               override per-user default",
    "  --insecure                     ws:// instead of wss:// (localhost dev)",
    "  --logout                       delete cached bearer for --host",
    "  --print-token                  print cached bearer (for piping into curl, etc.)",
    "  -h, --help                     show this help",
    ""
  ].join("\n"));
}

const args = readArgs();
if (args.help) { usage(); exit(0); }
if (!args.host) { usage(); exit(2); }

// --- token cache helpers ---
function tokenCachePath(host) {
  const safeName = String(host).replace(/[^a-z0-9.-]/gi, "_");
  return join(homedir(), ".config", "open-think", `auth-${safeName}.json`);
}
async function loadCachedToken(host) {
  try {
    const raw = await readFile(tokenCachePath(host), "utf8");
    const obj = JSON.parse(raw);
    if (obj.token && (!obj.expiresAt || obj.expiresAt > Date.now())) return obj.token;
  } catch {/* not present */}
  return null;
}
async function saveCachedToken(host, token, email) {
  const path = tokenCachePath(host);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({
      token,
      email,
      host,
      savedAt: new Date().toISOString(),
      // Match server-side TOKEN_TTL_MS
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    }, null, 2),
    { mode: 0o600 }
  );
}
async function deleteCachedToken(host) {
  try { await unlink(tokenCachePath(host)); } catch {/* not present */}
}

// --- handle --logout / --print-token first ---
if (args.logout) {
  await deleteCachedToken(args.host);
  stdout.write(`[36m· logged out (${args.host})[0m\n`);
  exit(0);
}
if (args["print-token"]) {
  const t = await loadCachedToken(args.host);
  if (t) { stdout.write(t + "\n"); exit(0); }
  stderr.write("no cached bearer for " + args.host + "\n");
  exit(1);
}

// --- pick auth strategy ---
const proto = args.insecure ? "ws" : "wss";
const httpProto = args.insecure ? "http" : "https";
const headers = {};
let usingBearer = null;

if (args.bearer) {
  usingBearer = args.bearer;
} else if (args["service-token-id"]) {
  headers["CF-Access-Client-Id"] = args["service-token-id"];
  headers["CF-Access-Client-Secret"] = args["service-token-secret"];
} else if (args["cf-access-jwt"]) {
  headers["CF-Access-Jwt-Assertion"] = args["cf-access-jwt"];
} else {
  // Device-code flow: cache → start → poll
  const cached = await loadCachedToken(args.host);
  if (cached) {
    usingBearer = cached;
  } else {
    usingBearer = await deviceCodeFlow(args.host, httpProto);
    if (!usingBearer) exit(1);
  }
}
if (usingBearer) headers["Authorization"] = `Bearer ${usingBearer}`;

// --- connect WS ---
const sessionPath = args.session ? `/${encodeURIComponent(args.session)}` : "";
const wsUrl = `${proto}://${args.host}/shell/ws${sessionPath}`;
stdout.write(`[36m· connecting to ${wsUrl}…[0m\n`);

const ws = new WebSocket(wsUrl, { headers });
let pingTimer = null;

ws.on("open", () => {
  stdout.write("[36m· connected. exit with Ctrl-D or close the window.[0m\n");
  const sendResize = () => {
    const cols = stdout.columns ?? 80;
    const rows = stdout.rows ?? 24;
    if (ws.readyState === WebSocket.OPEN) ws.send("r" + JSON.stringify({ cols, rows }));
  };
  sendResize();
  stdout.on("resize", sendResize);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send("i" + chunk);
  });
  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("p");
  }, 30000);
});

ws.on("message", (data) => {
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  if (buf.length < 1) return;
  const op = String.fromCharCode(buf[0]);
  const payload = buf.subarray(1);
  if (op === "o" || op === "m") { stdout.write(payload); return; }
  if (op === "E") { stdout.write(`[31m[bridge error][0m ${payload.toString("utf8")}\n`); return; }
  if (op === "e") { stdout.write(`[33m· pty exited (${payload.toString("utf8").replace(/\n/g, " ")})[0m\n`); return; }
});

ws.on("close", (code, reason) => {
  if (pingTimer) clearInterval(pingTimer);
  if (stdin.isTTY) stdin.setRawMode(false);
  stdout.write(`[36m· disconnected (code ${code}${reason ? ` · ${reason}` : ""})[0m\n`);
  // 401/403 close codes likely mean stale bearer — purge.
  if (code === 1008 || code === 4401) {
    stderr.write("[33m· auth rejected; clearing cached bearer. Re-run to re-authenticate.[0m\n");
    deleteCachedToken(args.host).catch(() => {});
  }
  exit(0);
});

ws.on("error", (err) => {
  stdout.write(`[31m· ws error:[0m ${err.message ?? err}\n`);
  exit(1);
});

process.on("SIGINT", () => {
  try { ws.close(1000, "SIGINT"); } catch {}
});

/* ---------------- device-code flow ---------------- */
async function deviceCodeFlow(host, httpProto) {
  const startUrl = `${httpProto}://${host}/cli-auth/start`;
  stdout.write(`[36m· first-run login — starting device-code flow…[0m\n`);
  let startRes;
  try {
    const r = await fetch(startUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cliInfo: `node ${process.version} on ${process.platform}`,
        appName: "open-think-shell"
      })
    });
    if (!r.ok) {
      stderr.write(`[31m/cli-auth/start failed: ${r.status} ${await r.text()}[0m\n`);
      return null;
    }
    startRes = await r.json();
  } catch (err) {
    stderr.write(`[31mfailed to reach /cli-auth/start: ${err.message ?? err}[0m\n`);
    return null;
  }
  const data = startRes.data ?? startRes;
  if (!data?.deviceCode || !data?.userCode) {
    stderr.write(`[31munexpected /cli-auth/start response[0m\n`);
    return null;
  }
  const deviceCode = data.deviceCode;
  const userCode = data.userCode;
  const verifyUrl = data.verifyUrl;
  const intervalMs = (data.interval ?? 2) * 1000;
  const expiresInMs = (data.expiresIn ?? 600) * 1000;
  const deadline = Date.now() + expiresInMs;

  stdout.write([
    "",
    `[33m  Open this URL in a browser:[0m`,
    `      [36m${verifyUrl}[0m`,
    "",
    `[33m  And confirm the code matches:[0m`,
    `      [1m${userCode}[0m`,
    "",
    `[2m  (Code expires in ${Math.floor(expiresInMs / 60000)} minutes)[0m`,
    ""
  ].join("\n"));

  // Poll until approved/denied/expired.
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, intervalMs));
    let pollRes;
    try {
      const r = await fetch(`${httpProto}://${host}/cli-auth/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode })
      });
      pollRes = await r.json();
    } catch (err) {
      stderr.write(`[31mpoll failed: ${err.message ?? err}; retrying…[0m\n`);
      continue;
    }
    const d = pollRes.data ?? pollRes;
    if (d?.status === "approved" && d?.token) {
      await saveCachedToken(host, d.token, d.email);
      stdout.write(`[36m· approved as ${d.email}. Token saved at ${tokenCachePath(host)}[0m\n`);
      return d.token;
    }
    if (d?.status === "denied") {
      stderr.write(`[31m· denied. Re-run if you want to try again.[0m\n`);
      return null;
    }
    if (d?.status === "expired") {
      stderr.write(`[31m· code expired. Re-run to start a fresh flow.[0m\n`);
      return null;
    }
    // pending — keep polling (silently)
  }
  stderr.write(`[31m· device code timed out.[0m\n`);
  return null;
}
