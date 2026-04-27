#!/usr/bin/env node
/**
 * open-think-codex-bridge
 *
 * Wraps the `codex app-server` stdio subprocess with an HTTP + SSE surface that Open Think's
 * `codex` plugin can consume.
 *
 * Endpoints:
 *   GET  /healthz              → 200 "ok" if the subprocess is alive
 *   POST /rpc                  → single JSON-RPC request → single JSON-RPC response
 *   POST /stream               → JSON-RPC request → text/event-stream of every response frame
 *                                 (notifications + terminal result/error). Ends on the
 *                                 terminal frame that matches the original request id.
 *
 * Auth: optional bearer token via BRIDGE_TOKEN env var. If set, every request must carry
 *       `Authorization: Bearer <token>`.
 *
 * Env:
 *   PORT                 (default 8787)
 *   BRIDGE_TOKEN         shared secret (optional; strongly recommended in prod)
 *   CODEX_BIN            path to the codex binary (default "codex")
 *   CODEX_ARGS           space-separated args (default "app-server")
 *   SUBPROCESS_TIMEOUT   per-RPC timeout in ms (default 120000)
 *
 * Restart policy: if `codex app-server` exits, this process exits too. Wrap in a supervisor
 * (systemd, Docker restart=always, Cloudflare Container restart, etc.).
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";
const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const CODEX_ARGS = (process.env.CODEX_ARGS ?? "app-server").split(/\s+/).filter(Boolean);
const SUBPROCESS_TIMEOUT = Number(process.env.SUBPROCESS_TIMEOUT ?? 120000);

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

log(`spawning: ${CODEX_BIN} ${CODEX_ARGS.join(" ")}`);
const proc = spawn(CODEX_BIN, CODEX_ARGS, { stdio: ["pipe", "pipe", "inherit"] });
proc.stdout.setEncoding("utf8");

proc.on("error", (err) => {
  log("subprocess error:", err.message);
  process.exit(1);
});
proc.on("exit", (code, signal) => {
  log(`subprocess exited code=${code} signal=${signal ?? ""}`);
  process.exit(code ?? 1);
});

/** id → { onFrame(frame), done() } */
const pendingSingle = new Map();
/** id → { write(frame) } — consumers of streaming frames */
const pendingStream = new Map();
let stdoutBuffer = "";

proc.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  let newlineIdx;
  while ((newlineIdx = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, newlineIdx).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch (err) {
      log("bad frame:", err.message, line.slice(0, 200));
      continue;
    }
    dispatchFrame(frame);
  }
});

function dispatchFrame(frame) {
  const id = frame?.id;
  const isTerminal = id !== undefined && id !== null && ("result" in frame || "error" in frame);

  // streams first — if a notification carries no id, we can still route by looking at the
  // currently-active single stream (simple heuristic: if exactly one stream is open)
  if (id !== undefined && pendingStream.has(id)) {
    const entry = pendingStream.get(id);
    entry.write(frame);
    if (isTerminal) {
      entry.close();
      pendingStream.delete(id);
    }
    return;
  }
  if (id === undefined && pendingStream.size === 1) {
    // notification with no id — broadcast to the single active stream
    const [, entry] = pendingStream.entries().next().value;
    entry.write(frame);
    return;
  }

  if (id !== undefined && pendingSingle.has(id)) {
    const entry = pendingSingle.get(id);
    if (isTerminal) {
      entry.resolve(frame);
      pendingSingle.delete(id);
    } else {
      // a single-mode RPC got a mid-stream notification; buffer it onto the final response
      entry.buffered ||= [];
      entry.buffered.push(frame);
    }
    return;
  }
}

function checkAuth(req, res) {
  if (!BRIDGE_TOKEN) return true;
  const auth = req.headers["authorization"] ?? "";
  if (auth === `Bearer ${BRIDGE_TOKEN}`) return true;
  res.writeHead(401, { "content-type": "text/plain" });
  res.end("unauthorized");
  return false;
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return {};
  return JSON.parse(body);
}

function writeJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function send(id, payload) {
  const out = JSON.stringify({ ...payload, id }) + "\n";
  proc.stdin.write(out);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "POST" && url.pathname === "/rpc") {
    if (!checkAuth(req, res)) return;
    let payload;
    try {
      payload = await readJson(req);
    } catch (err) {
      writeJson(res, 400, { error: { code: -32700, message: `bad request: ${err.message}` } });
      return;
    }
    if (!payload || typeof payload.method !== "string") {
      writeJson(res, 400, { error: { code: -32600, message: "method required" } });
      return;
    }
    const id = payload.id ?? randomUUID();
    const frame = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingSingle.delete(id);
        resolve({
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: `subprocess timeout after ${SUBPROCESS_TIMEOUT}ms` }
        });
      }, SUBPROCESS_TIMEOUT);
      pendingSingle.set(id, {
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        }
      });
      send(id, { jsonrpc: "2.0", method: payload.method, params: payload.params ?? {} });
    });
    writeJson(res, 200, frame);
    return;
  }

  if (req.method === "POST" && url.pathname === "/stream") {
    if (!checkAuth(req, res)) return;
    let payload;
    try {
      payload = await readJson(req);
    } catch (err) {
      writeJson(res, 400, { error: { code: -32700, message: `bad request: ${err.message}` } });
      return;
    }
    if (!payload || typeof payload.method !== "string") {
      writeJson(res, 400, { error: { code: -32600, message: "method required" } });
      return;
    }
    const id = payload.id ?? randomUUID();

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive"
    });
    res.write(`event: ready\ndata: {"id":"${id}"}\n\n`);

    let closed = false;
    const timer = setTimeout(() => {
      if (closed) return;
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: "timeout", timeoutMs: SUBPROCESS_TIMEOUT })}\n\n`
      );
      closed = true;
      pendingStream.delete(id);
      res.end();
    }, SUBPROCESS_TIMEOUT);

    pendingStream.set(id, {
      write: (frame) => {
        if (closed) return;
        const event =
          frame.result !== undefined
            ? "result"
            : frame.error !== undefined
              ? "error"
              : "notification";
        const data = JSON.stringify(frame);
        res.write(`event: ${event}\ndata: ${data}\n\n`);
      },
      close: () => {
        if (closed) return;
        clearTimeout(timer);
        res.write(`event: done\ndata: {}\n\n`);
        closed = true;
        res.end();
      }
    });

    req.on("close", () => {
      if (closed) return;
      clearTimeout(timer);
      closed = true;
      pendingStream.delete(id);
    });

    send(id, { jsonrpc: "2.0", method: payload.method, params: payload.params ?? {} });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  log(`open-think-codex-bridge listening on :${PORT}`);
  if (!BRIDGE_TOKEN) {
    log("WARNING: BRIDGE_TOKEN is not set — the bridge accepts requests from anyone who can reach it");
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`received ${signal}, shutting down`);
    server.close(() => {
      proc.kill("SIGTERM");
      process.exit(0);
    });
  });
}
