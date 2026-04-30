#!/usr/bin/env node
/**
 * Helm Shell CLI — terminal client for /shell/ws.
 *
 * Connects a local TTY to a remote Helm Shell container running on
 * Cloudflare. Same WebSocket protocol as the browser xterm.js client
 * (see src/app.ts mountShell + docker/shell/server.mjs).
 *
 * Usage:
 *   node scripts/open-think-shell.mjs --host helm.your-domain.workers.dev
 *   HELM_HOST=helm.your-domain.workers.dev node scripts/open-think-shell.mjs
 *   # local dev (skips auth via DEV_AUTH_BYPASS):
 *   node scripts/open-think-shell.mjs --host localhost:8787 --insecure
 *
 * Auth:
 *   - Cloudflare Access: pass --service-token-id and --service-token-secret
 *     (these become CF-Access-Client-{Id,Secret} headers).
 *   - JWT: pass --cf-access-jwt to send CF-Access-Jwt-Assertion directly.
 *   - DEV_AUTH_BYPASS: no auth — works for `wrangler dev` on localhost.
 *
 * Frame protocol: see docker/shell/server.mjs comment block.
 */
import { WebSocket } from "ws";
import { argv, env, exit, stdin, stdout } from "node:process";
import { parseArgs } from "node:util";

function readArgs() {
  const { values } = parseArgs({
    args: argv.slice(2),
    strict: false,
    options: {
      host: { type: "string", default: env.HELM_HOST ?? undefined },
      session: { type: "string", default: "default" },
      "service-token-id": { type: "string" },
      "service-token-secret": { type: "string" },
      "cf-access-jwt": { type: "string", default: env.CF_ACCESS_JWT ?? undefined },
      insecure: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" }
    }
  });
  return values;
}

function usage() {
  const lines = [
    "open-think-shell — terminal client for the Helm Shell container",
    "",
    "USAGE",
    "  node scripts/open-think-shell.mjs --host <host> [options]",
    "",
    "REQUIRED",
    "  --host <host>            e.g. helm.your-domain.workers.dev (or HELM_HOST env)",
    "",
    "OPTIONS",
    "  --session <name>         shell session name (default: \"default\")",
    "  --service-token-id <id>  Cloudflare Access service-token client id",
    "  --service-token-secret <s>  Cloudflare Access service-token client secret",
    "  --cf-access-jwt <jwt>    raw Access JWT (CF-Access-Jwt-Assertion header)",
    "  --insecure               use ws:// instead of wss:// (localhost dev)",
    "  -h, --help               show this help",
    "",
    "ENV",
    "  HELM_HOST                default for --host",
    "  CF_ACCESS_JWT            default for --cf-access-jwt",
    ""
  ];
  stdout.write(lines.join("\n"));
}

const args = readArgs();
if (args.help || !args.host) {
  usage();
  exit(args.help ? 0 : 2);
}

const proto = args.insecure ? "ws" : "wss";
const url = `${proto}://${args.host}/shell/ws/${encodeURIComponent(args.session)}`;
const headers = {};
if (args["service-token-id"]) headers["CF-Access-Client-Id"] = args["service-token-id"];
if (args["service-token-secret"]) headers["CF-Access-Client-Secret"] = args["service-token-secret"];
if (args["cf-access-jwt"]) headers["CF-Access-Jwt-Assertion"] = args["cf-access-jwt"];

stdout.write(`[36m· connecting to ${url}…[0m\n`);

const ws = new WebSocket(url, { headers });
let pingTimer = null;

ws.on("open", () => {
  stdout.write("[36m· connected. exit with Ctrl-D or close the window.[0m\n");

  // Local terminal dimensions → resize the remote PTY.
  const sendResize = () => {
    const cols = stdout.columns ?? 80;
    const rows = stdout.rows ?? 24;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("r" + JSON.stringify({ cols, rows }));
    }
  };
  sendResize();
  stdout.on("resize", sendResize);

  // Raw mode so Ctrl-C / Ctrl-Z / arrows / etc. flow through unmolested.
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send("i" + chunk);
  });

  // Heartbeat to keep CF edge from idling us out (~100s threshold).
  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("p");
  }, 30000);
});

ws.on("message", (data) => {
  // Server frames: "o" + bytes (stdout), "e" + msg (exit), "P" (pong),
  //                "m" + bytes (motd), "E" + bytes (bridge error).
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  if (buf.length < 1) return;
  const op = String.fromCharCode(buf[0]);
  const payload = buf.subarray(1);
  if (op === "o" || op === "m") {
    stdout.write(payload);
    return;
  }
  if (op === "E") {
    stdout.write(`[31m[bridge error][0m ${payload.toString("utf8")}\n`);
    return;
  }
  if (op === "e") {
    stdout.write(`[33m· pty exited (${payload.toString("utf8").replace(/\n/g, " ")})[0m\n`);
    return;
  }
  if (op === "P") return; // pong — silent
});

ws.on("close", (code, reason) => {
  if (pingTimer) clearInterval(pingTimer);
  if (stdin.isTTY) stdin.setRawMode(false);
  stdout.write(`[36m· disconnected (code ${code}${reason ? ` · ${reason}` : ""})[0m\n`);
  exit(0);
});

ws.on("error", (err) => {
  stdout.write(`[31m· ws error:[0m ${err.message ?? err}\n`);
  exit(1);
});

// SIGINT (Ctrl-C in raw mode is forwarded to the remote PTY by the input
// handler; this fires when stdin is NOT raw, e.g. before the WS opens, or
// if the user signals from outside the terminal).
process.on("SIGINT", () => {
  try { ws.close(1000, "SIGINT"); } catch {}
});
