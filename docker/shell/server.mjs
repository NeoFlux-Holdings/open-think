#!/usr/bin/env node
/**
 * Helm Shell — WebSocket↔PTY bridge.
 *
 * This is what the Cloudflare Container runs. The Worker proxies WebSocket
 * upgrades from `/shell/ws` straight to this server (port 7681). One PTY
 * is spawned per WebSocket connection.
 *
 * Frame protocol (deliberately tiny — first byte is the opcode):
 *
 *   client → server:
 *     "i" + bytes        — stdin (raw, UTF-8)
 *     "r" + JSON         — resize, payload {cols:n, rows:n}
 *     "p" + ""           — ping (server replies "P")
 *     "S" + bytes        — signal name (rare; mostly for "INT" before EOF)
 *
 *   server → client:
 *     "o" + bytes        — stdout (raw, UTF-8)
 *     "e" + bytes        — pty exited; payload = "code:N\nsignal:S"
 *     "P" + ""           — pong
 *     "m" + bytes        — motd / banner text printed once on connect
 *     "E" + bytes        — server error (e.g. spawn failure)
 *
 * We intentionally use a 1-byte opcode + raw payload rather than JSON-
 * everywhere because PTY output bursts can be large (think `tail -f`
 * spitting hundreds of KB/s) and we don't want to pay base64 + JSON
 * parsing on the hot path. xterm.js writes raw bytes to its decoder.
 *
 * Idle behavior: the CF Container's `sleepAfter` setting handles
 * shutdown. We also kill the PTY on WS close so a hung browser tab
 * doesn't leak processes.
 */
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HELM_SHELL_PORT ?? 7681);
const SHELL = process.env.SHELL ?? "/bin/bash";
const HOME = process.env.HOME ?? "/workspace";

let MOTD = "";
try {
  MOTD = readFileSync(join(__dirname, "motd.txt"), "utf8");
} catch {
  // motd is optional; missing file is fine.
}

// --- HTTP server (also serves /healthz so the Container platform can
//     health-check before sending traffic). The WSS attaches to upgrades.
const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, shell: SHELL, ts: new Date().toISOString() }));
    return;
  }

  // POST /exec — one-shot command runner the Worker proxies into for
  // the helm-exec skill. Lets the agent do things like:
  //   git clone https://github.com/user/repo /workspace/repo
  //   sed -i 's/.../.../' /workspace/repo/wrangler.toml
  //   wrangler deploy --cwd /workspace/repo
  // Output is captured (not streamed), capped at 256 KB, with a default
  // 60s timeout. Auth is the Worker proxy's responsibility — by the
  // time a request reaches port 7681, it's already passed through the
  // Worker's auth gate.
  if (req.method === "POST" && (req.url === "/exec" || req.url === "/exec/")) {
    const chunks = [];
    let total = 0;
    const MAX_BODY = 256 * 1024;
    for await (const c of req) {
      total += c.length;
      if (total > MAX_BODY) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "request body > 256 KB" }));
        return;
      }
      chunks.push(c);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid JSON body" }));
      return;
    }
    const cmd = typeof body.cmd === "string" ? body.cmd : "";
    if (!cmd) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "body.cmd required" }));
      return;
    }
    const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : HOME;
    const timeoutMs = Number.isFinite(body.timeoutMs)
      ? Math.min(Math.max(1000, body.timeoutMs), 600_000)
      : 60_000;
    const stdin = typeof body.stdin === "string" ? body.stdin : "";

    const startedAt = Date.now();
    const child = spawn("bash", ["-l", "-c", cmd], {
      cwd,
      env: {
        ...process.env,
        TERM: "dumb",
        // Pass the in-shell helpers along.
        HELM_INTERNAL_TOKEN: process.env.HELM_INTERNAL_TOKEN ?? "",
        HELM_WORKER_HOST: process.env.HELM_WORKER_HOST ?? "",
        HELM_SESSION: process.env.HELM_SESSION ?? "default"
      }
    });

    let stdout = "";
    let stderr = "";
    const MAX_OUT = 256 * 1024;
    let truncated = false;
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUT) {
        stdout += d.toString("utf8");
        if (stdout.length > MAX_OUT) {
          stdout = stdout.slice(0, MAX_OUT);
          truncated = true;
        }
      }
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUT) {
        stderr += d.toString("utf8");
        if (stderr.length > MAX_OUT) {
          stderr = stderr.slice(0, MAX_OUT);
          truncated = true;
        }
      }
    });
    if (stdin) {
      try { child.stdin.write(stdin); } catch { /* noop */ }
    }
    try { child.stdin.end(); } catch { /* noop */ }

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      // Hard-kill if SIGTERM doesn't take after 5s.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 5000).unref();
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: !timedOut && code === 0,
          stdout,
          stderr,
          code,
          signal: signal ?? null,
          durationMs,
          truncated,
          timedOut,
          cwd,
          cmd: cmd.length > 200 ? cmd.slice(0, 200) + "…" : cmd
        })
      );
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    });
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    // A tiny "you reached the bridge directly" hint. Browsers don't see
    // this normally — the Worker rewrites paths so /shell goes through
    // the WS upgrade only.
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Helm Shell bridge — WS at /ws, exec at POST /exec\n");
    return;
  }
  res.writeHead(404);
  res.end("not found\n");
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on("upgrade", (req, socket, head) => {
  // Accept any path — the Worker is responsible for routing.
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const remote = req.socket?.remoteAddress ?? "?";
  const session = new URL(req.url ?? "/", "http://x").searchParams.get("session") ?? "default";
  console.log(`[shell] connect from=${remote} session=${session}`);

  /** @type {ReturnType<typeof pty.spawn>|null} */
  let term = null;

  function startPty(cols = 80, rows = 24) {
    try {
      term = pty.spawn(SHELL, ["-l"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: HOME,
        env: {
          ...process.env,
          HELM_SESSION: session,
          PS1: "\\[\\e[36m\\]helm\\[\\e[0m\\]:\\[\\e[33m\\]\\w\\[\\e[0m\\]$ "
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ws.send("E" + `failed to spawn pty: ${msg}`);
      ws.close(1011, "pty spawn failed");
      return;
    }
    term.onData((data) => {
      try {
        ws.send("o" + data);
      } catch {
        // Socket already closed; node-pty will see the kill on close handler.
      }
    });
    term.onExit(({ exitCode, signal }) => {
      try {
        ws.send("e" + `code:${exitCode}\nsignal:${signal ?? ""}`);
      } catch {
        /* noop */
      }
      ws.close(1000, "pty exited");
    });
  }

  // Greet first so the user knows the connection is live before we wait
  // for them to type. The MOTD also makes the empty container feel less
  // ghost-town.
  if (MOTD) {
    try {
      ws.send("m" + MOTD);
    } catch {
      /* noop */
    }
  }

  ws.on("message", (raw) => {
    if (typeof raw !== "string" && !(raw instanceof Buffer)) return;
    const buf = typeof raw === "string" ? Buffer.from(raw) : raw;
    if (buf.length < 1) return;
    const op = String.fromCharCode(buf[0]);
    const payload = buf.subarray(1);

    if (op === "p") {
      try {
        ws.send("P");
      } catch {
        /* noop */
      }
      return;
    }

    if (op === "r") {
      try {
        const { cols, rows } = JSON.parse(payload.toString("utf8"));
        if (!term) {
          startPty(Math.max(2, cols | 0), Math.max(2, rows | 0));
          return;
        }
        term.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
      } catch {
        /* malformed resize — ignore */
      }
      return;
    }

    if (op === "S") {
      // Signal injection. Scope: only INT (Ctrl-C) and TSTP (Ctrl-Z) are
      // useful — others are too easy to misuse and PTYs already let users
      // send raw control bytes through "i".
      if (!term) return;
      const sig = payload.toString("utf8");
      if (sig === "INT" || sig === "TSTP") {
        try {
          term.kill(sig);
        } catch {
          /* noop */
        }
      }
      return;
    }

    if (op === "i") {
      if (!term) {
        // First input before resize → spawn with default size.
        startPty();
      }
      try {
        term.write(payload);
      } catch {
        /* noop */
      }
      return;
    }

    // Unknown opcode — silently drop. Clients on different versions
    // shouldn't crash the bridge.
  });

  ws.on("close", (code, reason) => {
    console.log(
      `[shell] close session=${session} code=${code} reason=${reason?.toString?.() ?? ""}`
    );
    if (term) {
      try {
        term.kill();
      } catch {
        /* noop */
      }
      term = null;
    }
  });

  ws.on("error", (err) => {
    console.error(`[shell] ws error session=${session}:`, err);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[shell] listening on :${PORT} (shell=${SHELL}, home=${HOME})`);
});

// Cloudflare Containers send SIGTERM ~10s before forced kill on sleep.
// Close all sockets cleanly so the client gets a 1001 (going away) and
// can prompt to reconnect, instead of a half-open hang.
function shutdown(reason) {
  console.log(`[shell] shutdown (${reason})`);
  for (const client of wss.clients) {
    try {
      client.close(1001, "container sleeping");
    } catch {
      /* noop */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
