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
const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, shell: SHELL, ts: new Date().toISOString() }));
    return;
  }
  if (req.url === "/" || req.url === "/index.html") {
    // A tiny "you reached the bridge directly" hint. Browsers don't see
    // this normally — the Worker rewrites paths so /shell goes through
    // the WS upgrade only.
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Helm Shell bridge — WebSocket only at /ws\n");
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
