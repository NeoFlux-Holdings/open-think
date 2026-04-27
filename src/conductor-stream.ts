import type { AgentRuntime } from "./core/runtime";
import type { SkillManager } from "./core/skills";
import type { Env } from "./types";
import { AppError } from "./core/errors";
import { buildSystemPrompt, CONDUCTOR_SESSION_DEFAULT } from "./conductor";

interface StreamInput {
  sessionName?: string;
  content: string;
  threadId?: string;
  model?: string;
  mode?: "selective" | "auto";
  /** If set, subscribe to an existing hub rather than creating a new one. */
  streamId?: string;
}

/**
 * POST /conductor/stream — start a new streaming turn. Creates a StreamHubDO,
 * opens an SSE subscription to it, and returns the SSE stream to the caller.
 * The `x-stream-id` response header identifies the hub so additional tabs can
 * join via GET /conductor/stream/:id.
 *
 * Requires CODEX_APP_SERVER_URL pointing at a ws(s):// endpoint.
 */
export async function handleConductorStreamStart(
  request: Request,
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager
): Promise<Response> {
  if (!env.CODEX_APP_SERVER_URL) {
    throw new AppError(
      "E_STREAM_NOT_CONFIGURED",
      "CODEX_APP_SERVER_URL is required for /conductor/stream. See docs/CODEX_APPSERVER.md.",
      400
    );
  }
  const scheme = env.CODEX_APP_SERVER_URL.split(":")[0]?.toLowerCase();
  if (scheme !== "ws" && scheme !== "wss") {
    throw new AppError(
      "E_STREAM_NEEDS_WS",
      `/conductor/stream needs a ws(s):// CODEX_APP_SERVER_URL (got ${scheme}://).`,
      400
    );
  }
  if (!env.AGENT_SESSIONS || !env.STREAM_HUBS) {
    throw new AppError(
      "E_DO_BINDING_MISSING",
      "AGENT_SESSIONS and STREAM_HUBS Durable Object bindings are required",
      500
    );
  }

  const body = (await request.json()) as StreamInput;
  if (!body?.content || typeof body.content !== "string") {
    throw new AppError("E_BAD_REQUEST", "content is required", 400);
  }

  const sessionName = body.sessionName ?? CONDUCTOR_SESSION_DEFAULT;

  // Persist the user message to the session DO up front so even if the stream
  // fails we've captured the intent.
  const sessionDoId = env.AGENT_SESSIONS.idFromName(sessionName);
  const sessionStub = env.AGENT_SESSIONS.get(sessionDoId);
  await sessionStub.fetch(
    new Request("https://do/init", {
      method: "POST",
      body: JSON.stringify({ title: "Streaming turn" })
    })
  );
  await sessionStub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify({ role: "user", content: body.content })
    })
  );

  // Create a fresh hub for this turn.
  const streamId = body.streamId ?? `stream-${crypto.randomUUID()}`;
  const hubId = env.STREAM_HUBS.idFromName(streamId);
  const hubStub = env.STREAM_HUBS.get(hubId);

  const systemPrompt = buildSystemPrompt(skills.listSkills(), body.mode ?? "auto");

  const initResponse = await hubStub.fetch(
    new Request("https://do/init", {
      method: "POST",
      body: JSON.stringify({
        id: streamId,
        sessionName,
        content: body.content,
        model: body.model,
        mode: body.mode ?? "auto",
        upstreamUrl: env.CODEX_APP_SERVER_URL,
        upstreamToken: env.CODEX_APP_SERVER_TOKEN,
        upstreamTimeoutMs: Number(env.CODEX_APP_SERVER_TIMEOUT_MS ?? 120000) || 120000,
        systemPrompt,
        threadId: body.threadId
      })
    })
  );
  if (!initResponse.ok) {
    const errBody = await initResponse.text();
    throw new AppError("E_HUB_INIT_FAILED", `hub init failed: ${errBody.slice(0, 300)}`, 502);
  }

  // Subscribe to the hub's SSE feed.
  const subResponse = await hubStub.fetch(new Request("https://do/subscribe"));
  if (!subResponse.ok) {
    throw new AppError("E_HUB_SUBSCRIBE_FAILED", "hub subscribe failed", 502);
  }

  const headers = new Headers(subResponse.headers);
  headers.set("x-stream-id", streamId);
  return new Response(subResponse.body, {
    status: subResponse.status,
    headers
  });
}

/**
 * GET /conductor/stream/:streamId — reconnect to an existing hub. Replays the
 * buffered events so the new subscriber picks up roughly where they left off.
 */
export async function handleConductorStreamSubscribe(
  env: Env,
  streamId: string
): Promise<Response> {
  if (!env.STREAM_HUBS) {
    throw new AppError("E_DO_BINDING_MISSING", "STREAM_HUBS binding required", 500);
  }
  if (!streamId) {
    throw new AppError("E_BAD_REQUEST", "streamId is required", 400);
  }
  const hubId = env.STREAM_HUBS.idFromName(streamId);
  const hubStub = env.STREAM_HUBS.get(hubId);
  return hubStub.fetch(new Request("https://do/subscribe"));
}

/**
 * POST /conductor/stream/:streamId/interrupt — cancel the in-flight turn.
 * Issues `turn/interrupt` to the app-server over a short-lived WebSocket.
 */
export async function handleConductorStreamInterrupt(
  request: Request,
  env: Env,
  streamId: string
): Promise<Response> {
  if (!env.STREAM_HUBS) {
    throw new AppError("E_DO_BINDING_MISSING", "STREAM_HUBS binding required", 500);
  }
  if (!streamId) {
    throw new AppError("E_BAD_REQUEST", "streamId is required", 400);
  }
  const hubId = env.STREAM_HUBS.idFromName(streamId);
  const hubStub = env.STREAM_HUBS.get(hubId);
  const body = await request.text();
  return hubStub.fetch(
    new Request("https://do/interrupt", {
      method: "POST",
      body: body || "{}",
      headers: { "content-type": "application/json" }
    })
  );
}

/**
 * GET /conductor/stream/:streamId/state — peek at the hub's current state
 * without subscribing. Useful for the UI to show status before connecting SSE.
 */
export async function handleConductorStreamState(
  env: Env,
  streamId: string
): Promise<Response> {
  if (!env.STREAM_HUBS) {
    throw new AppError("E_DO_BINDING_MISSING", "STREAM_HUBS binding required", 500);
  }
  if (!streamId) {
    throw new AppError("E_BAD_REQUEST", "streamId is required", 400);
  }
  const hubId = env.STREAM_HUBS.idFromName(streamId);
  const hubStub = env.STREAM_HUBS.get(hubId);
  return hubStub.fetch(new Request("https://do/state"));
}
