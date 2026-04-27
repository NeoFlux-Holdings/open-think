import { AppError } from "../core/errors";

/**
 * Minimal JSON-RPC 2.0 client for the Codex app-server.
 *
 * Auto-detects transport by URL scheme:
 *   - https:// / http://  → POST body is a single JSON-RPC request; response is a single JSON-RPC envelope.
 *     (The app-server itself speaks stdio/WS; assume a tiny HTTP shim in front when using this path.)
 *   - wss://   / ws://    → single-shot WebSocket: upgrade, send request, read one response frame, close.
 *
 * For multi-turn streaming (e.g. `turn/start` progress notifications), callers should switch to a
 * long-lived WebSocket held by a Durable Object. This client is request/response only.
 */

export interface CodexRpcOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export interface CodexRpcRequest {
  method: string;
  params?: unknown;
  id?: string | number;
}

export interface CodexRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

function buildPayload(req: CodexRpcRequest) {
  return {
    jsonrpc: "2.0" as const,
    id: req.id ?? crypto.randomUUID(),
    method: req.method,
    params: req.params
  };
}

export async function rpcCall<T = unknown>(
  options: CodexRpcOptions,
  req: CodexRpcRequest
): Promise<CodexRpcResponse<T>> {
  if (!options.url) {
    throw new AppError("E_BAD_REQUEST", "CODEX_APP_SERVER_URL not configured", 400);
  }
  const scheme = options.url.split(":")[0]?.toLowerCase();
  if (scheme === "http" || scheme === "https") {
    return await rpcHttp<T>(options, req);
  }
  if (scheme === "ws" || scheme === "wss") {
    return await rpcWebSocket<T>(options, req);
  }
  throw new AppError(
    "E_UNSUPPORTED_SCHEME",
    `codex app-server URL must use http(s) or ws(s) scheme (got '${scheme}')`,
    400
  );
}

async function rpcHttp<T>(
  options: CodexRpcOptions,
  req: CodexRpcRequest
): Promise<CodexRpcResponse<T>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const payload = buildPayload(req);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const controller = new AbortController();
  const timer = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new AppError(
        "E_RPC_HTTP_ERROR",
        `app-server HTTP ${response.status}: ${text.slice(0, 300)}`,
        502
      );
    }
    const text = await response.text();
    return JSON.parse(text) as CodexRpcResponse<T>;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface JsonRpcFrame<T = unknown> {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Long-lived JSON-RPC streaming call. Opens a WebSocket to the app-server, sends one
 * request, and yields every incoming frame (notifications + final response) until the
 * server sends a frame whose `id` matches the request id AND contains `result` or `error`.
 *
 * Only supports ws:// / wss:// URLs. HTTP streaming would require a shim that speaks SSE;
 * defer that until a concrete use case appears.
 */
export async function* rpcStream<T = unknown>(
  options: CodexRpcOptions,
  req: CodexRpcRequest
): AsyncGenerator<JsonRpcFrame<T>, void, unknown> {
  const scheme = options.url.split(":")[0]?.toLowerCase();
  if (scheme !== "ws" && scheme !== "wss") {
    throw new AppError(
      "E_UNSUPPORTED_SCHEME",
      `rpcStream requires a ws(s):// URL (got '${scheme}')`,
      400
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const payload = buildPayload(req);
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    Connection: "Upgrade"
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetchImpl(options.url, { method: "GET", headers });
  if (response.status !== 101) {
    const text = await response.text().catch(() => "");
    throw new AppError(
      "E_RPC_WS_UPGRADE_FAILED",
      `app-server WebSocket upgrade failed (${response.status}): ${text.slice(0, 300)}`,
      502
    );
  }
  const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) {
    throw new AppError(
      "E_RPC_WS_NO_SOCKET",
      "Worker runtime did not return a WebSocket on upgrade response",
      500
    );
  }
  ws.accept();

  const queue: JsonRpcFrame<T>[] = [];
  const waiters: Array<(frame: JsonRpcFrame<T> | null) => void> = [];
  let finished = false;
  let errorState: Error | null = null;

  const release = (frame: JsonRpcFrame<T> | null) => {
    if (waiters.length > 0) {
      const next = waiters.shift()!;
      next(frame);
    } else if (frame !== null) {
      queue.push(frame);
    }
  };

  const isTerminal = (frame: JsonRpcFrame<T>) =>
    frame.id !== undefined && frame.id === payload.id && ("result" in frame || "error" in frame);

  const timeout = options.timeoutMs
    ? setTimeout(() => {
        errorState = new AppError(
          "E_RPC_WS_TIMEOUT",
          `app-server WS stream timeout after ${options.timeoutMs}ms`,
          504
        );
        finished = true;
        while (waiters.length > 0) waiters.shift()!(null);
        try { ws.close(1000, "timeout"); } catch { /* already closed */ }
      }, options.timeoutMs)
    : undefined;

  ws.addEventListener("message", (event: MessageEvent) => {
    try {
      const text =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      const frame = JSON.parse(text) as JsonRpcFrame<T>;
      release(frame);
      if (isTerminal(frame)) {
        finished = true;
        if (timeout) clearTimeout(timeout);
        try { ws.close(1000, "done"); } catch { /* already closed */ }
        while (waiters.length > 0) waiters.shift()!(null);
      }
    } catch (err) {
      errorState = err as Error;
      finished = true;
      while (waiters.length > 0) waiters.shift()!(null);
    }
  });

  ws.addEventListener("close", () => {
    finished = true;
    if (timeout) clearTimeout(timeout);
    while (waiters.length > 0) waiters.shift()!(null);
  });

  ws.addEventListener("error", () => {
    errorState = new AppError("E_RPC_WS_ERROR", "app-server WebSocket error", 502);
    finished = true;
    while (waiters.length > 0) waiters.shift()!(null);
  });

  ws.send(JSON.stringify(payload));

  try {
    while (true) {
      if (queue.length > 0) {
        const frame = queue.shift()!;
        yield frame;
        if (isTerminal(frame)) break;
        continue;
      }
      if (finished) break;
      const frame = await new Promise<JsonRpcFrame<T> | null>((resolve) => {
        waiters.push(resolve);
      });
      if (frame === null) break;
      yield frame;
      if (isTerminal(frame)) break;
    }
    if (errorState) throw errorState;
  } finally {
    if (timeout) clearTimeout(timeout);
    try { ws.close(); } catch { /* already closed */ }
  }
}

async function rpcWebSocket<T>(
  options: CodexRpcOptions,
  req: CodexRpcRequest
): Promise<CodexRpcResponse<T>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const payload = buildPayload(req);
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    Connection: "Upgrade"
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetchImpl(options.url, { method: "GET", headers });
  if (response.status !== 101) {
    const text = await response.text().catch(() => "");
    throw new AppError(
      "E_RPC_WS_UPGRADE_FAILED",
      `app-server WebSocket upgrade failed (${response.status}): ${text.slice(0, 300)}`,
      502
    );
  }
  const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) {
    throw new AppError(
      "E_RPC_WS_NO_SOCKET",
      "Worker runtime did not return a WebSocket on upgrade response",
      500
    );
  }
  ws.accept();

  try {
    return await new Promise<CodexRpcResponse<T>>((resolve, reject) => {
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            ws.close(1000, "timeout");
            reject(
              new AppError("E_RPC_WS_TIMEOUT", `app-server WS timeout after ${options.timeoutMs}ms`, 504)
            );
          }, options.timeoutMs)
        : undefined;

      ws.addEventListener("message", (event: MessageEvent) => {
        if (timeout) clearTimeout(timeout);
        try {
          const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
          const parsed = JSON.parse(text) as CodexRpcResponse<T>;
          if (parsed.id === payload.id) {
            resolve(parsed);
            ws.close(1000, "done");
          }
        } catch (err) {
          reject(err);
          ws.close(1011, "bad response");
        }
      });
      ws.addEventListener("error", () => {
        if (timeout) clearTimeout(timeout);
        reject(new AppError("E_RPC_WS_ERROR", "app-server WebSocket error", 502));
      });
      ws.addEventListener("close", (event: CloseEvent) => {
        if (timeout) clearTimeout(timeout);
        reject(
          new AppError(
            "E_RPC_WS_CLOSED",
            `app-server WebSocket closed before response (code=${event.code})`,
            502
          )
        );
      });

      ws.send(JSON.stringify(payload));
    });
  } finally {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}
