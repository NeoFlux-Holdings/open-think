import type { AgentRuntime } from "./core/runtime";
import type { SkillManager } from "./core/skills";
import type { Env, SessionMessage } from "./types";
import { AppError, toAppError } from "./core/errors";
import { buildSystemPrompt, CONDUCTOR_SESSION_DEFAULT } from "./conductor";
import { runAnthropicToolStream } from "./anthropic-stream";
import { runOpenAICompatibleToolStream } from "./openai-stream";
import type { LoopEvent, ToolLoopConfig } from "./tool-stream-types";

type ToolStreamProvider = "anthropic" | "openrouter" | "openai-compatible" | "cf-ai-gateway";

interface ToolStreamInput {
  sessionName?: string;
  content: string;
  provider?: ToolStreamProvider;
  model?: string;
  mode?: "propose" | "selective" | "auto";
  maxIterations?: number;
}

/**
 * POST /conductor/stream-tools — native tool-use streaming across providers.
 *
 * Auto-picks a provider from the enabled plugin set (preferring anthropic →
 * cf-ai-gateway → openai-compatible) unless the caller forces one via the
 * `provider` field. Pipes a single tool-use loop into an SSE response while
 * the upstream provider streams deltas; tool calls execute inside the loop.
 *
 * Every adapter emits the same LoopEvent union — the SSE frames look
 * identical to the browser regardless of which model served the turn.
 */
export async function handleConductorToolStream(
  request: Request,
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager
): Promise<Response> {
  const body = (await request.json()) as ToolStreamInput;
  if (!body?.content || typeof body.content !== "string") {
    throw new AppError("E_BAD_REQUEST", "content is required", 400);
  }
  if (!env.AGENT_SESSIONS) {
    throw new AppError("E_DO_BINDING_MISSING", "AGENT_SESSIONS binding required", 500);
  }

  const enabled = new Set(runtime.listPlugins().map((p) => p.id));
  const provider = selectProvider(env, enabled, body.provider);

  const sessionName = body.sessionName ?? CONDUCTOR_SESSION_DEFAULT;
  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);

  await stub.fetch(
    new Request("https://do/init", {
      method: "POST",
      body: JSON.stringify({ title: "Streaming tool turn" })
    })
  );
  const history = await loadHistory(stub);
  await stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify({ role: "user", content: body.content })
    })
  );

  const systemPrompt = buildSystemPrompt(skills.listSkills(), body.mode ?? "selective");
  const baseConfig: ToolLoopConfig = {
    env,
    runtime,
    skillList: skills.listSkills(),
    systemPrompt,
    messages: toConversationHistory(history),
    userContent: body.content,
    model: body.model,
    maxIterations: body.maxIterations,
    mode: body.mode ?? "selective"
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const streamId = `stream-tools-${crypto.randomUUID()}`;

  const sseFrame = (event: string, data: unknown) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
  };

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  request.signal?.addEventListener("abort", onAbort);

  (async () => {
    try {
      await writer.write(sseFrame("ready", { streamId, provider, sessionName }));

      const loopConfig: ToolLoopConfig = {
        ...baseConfig,
        abortSignal: abortController.signal
      };

      const generator = createGenerator(provider, env, loopConfig);
      let finalText = "";
      for await (const event of generator) {
        await writer.write(sseFrame(event.kind, event));
        if (event.kind === "loop-done") {
          finalText = event.finalText;
        }
      }

      if (finalText) {
        await stub.fetch(
          new Request("https://do/messages", {
            method: "POST",
            body: JSON.stringify({
              role: "assistant",
              name: `${provider}:stream-tools`,
              content: finalText
            })
          })
        );
      }

      await writer.write(sseFrame("done", { finalText }));
    } catch (err) {
      const e = toAppError(err);
      await writer
        .write(sseFrame("error", { message: e.message, code: e.code }))
        .catch(() => undefined);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      await writer.close().catch(() => undefined);
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
      "x-stream-id": streamId,
      "x-stream-provider": provider
    }
  });
}

function selectProvider(
  env: Env,
  enabled: Set<string>,
  requested?: ToolStreamProvider
): ToolStreamProvider {
  if (requested) {
    if (!enabled.has(requested)) {
      throw new AppError(
        "E_UNSUPPORTED_PROVIDER",
        `stream-tools requested provider '${requested}' but it is not enabled`,
        400
      );
    }
    return requested;
  }
  // OpenRouter is the new top-priority default — auto-router picks the best
  // model per prompt without the user thinking about model selection.
  if (enabled.has("openrouter") && env.OPENROUTER_API_KEY) return "openrouter";
  if (enabled.has("anthropic") && env.ANTHROPIC_API_KEY) return "anthropic";
  if (enabled.has("cf-ai-gateway") && env.AI_GATEWAY_ID && env.CLOUDFLARE_ACCOUNT_ID) return "cf-ai-gateway";
  if (enabled.has("openai-compatible") && env.OPENAI_COMPATIBLE_URL) return "openai-compatible";
  throw new AppError(
    "E_NO_STREAMING_PROVIDER",
    "stream-tools requires one of: openrouter (OPENROUTER_API_KEY), anthropic (ANTHROPIC_API_KEY), cf-ai-gateway (AI_GATEWAY_ID + CLOUDFLARE_ACCOUNT_ID), or openai-compatible (OPENAI_COMPATIBLE_URL).",
    400
  );
}

function createGenerator(
  provider: ToolStreamProvider,
  env: Env,
  config: ToolLoopConfig
): AsyncGenerator<LoopEvent, void, unknown> {
  if (provider === "anthropic") {
    return runAnthropicToolStream(config);
  }
  if (provider === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      throw new AppError(
        "E_OPENROUTER_KEY_MISSING",
        "OPENROUTER_API_KEY required for openrouter streaming. Get one at openrouter.ai/settings/keys.",
        400
      );
    }
    const orBase = (env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    const orHeaders: Record<string, string> = {
      "X-Title": env.OPENROUTER_X_TITLE ?? "Open Think Helm"
    };
    if (env.OPENROUTER_HTTP_REFERER) orHeaders["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
    return runOpenAICompatibleToolStream({
      ...config,
      // Default to OR's auto-router when caller didn't pin a model.
      model: config.model ?? env.OPENROUTER_DEFAULT_MODEL ?? "openrouter/auto",
      baseUrl: orBase,
      apiKey: env.OPENROUTER_API_KEY,
      providerLabel: "openrouter",
      extraHeaders: orHeaders
    });
  }
  if (provider === "openai-compatible") {
    if (!env.OPENAI_COMPATIBLE_URL) {
      throw new AppError(
        "E_OAI_URL_MISSING",
        "OPENAI_COMPATIBLE_URL required for openai-compatible streaming",
        400
      );
    }
    return runOpenAICompatibleToolStream({
      ...config,
      baseUrl: env.OPENAI_COMPATIBLE_URL,
      apiKey: env.OPENAI_COMPATIBLE_KEY,
      providerLabel: "openai-compatible"
    });
  }
  // cf-ai-gateway — compat endpoint speaks OpenAI format, model prefix routes provider
  if (!env.AI_GATEWAY_ID || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new AppError(
      "E_CF_GATEWAY_CONFIG",
      "cf-ai-gateway streaming needs AI_GATEWAY_ID + CLOUDFLARE_ACCOUNT_ID",
      400
    );
  }
  const gatewayBase = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/compat`;
  const extraHeaders: Record<string, string> = {};
  if (env.AI_GATEWAY_AUTH_TOKEN) {
    extraHeaders["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_AUTH_TOKEN}`;
  }
  return runOpenAICompatibleToolStream({
    ...config,
    baseUrl: gatewayBase,
    apiKey: env.OPENAI_COMPATIBLE_KEY,
    providerLabel: "cf-ai-gateway",
    extraHeaders
  });
}

async function loadHistory(
  stub: { fetch: (req: Request) => Promise<Response> }
): Promise<SessionMessage[]> {
  const response = await stub.fetch(new Request("https://do/messages"));
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { data?: SessionMessage[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

/* ---------------- Callback-based core ----------------
 * Same loop as handleConductorToolStream but emits LoopEvents through a
 * caller-supplied callback instead of writing SSE frames. Used by the
 * ChatSessionDO to pipe streaming events directly into WebSocket frames.
 *
 * Identical semantics: loads history, saves user message, runs the
 * provider-specific generator, persists the final assistant text, then
 * returns a summary. abortSignal aborts the upstream provider fetch
 * cleanly — the generator yields a `loop-done {reason: "cancelled"}`
 * event before terminating.
 */

export interface CallbackStreamInput {
  sessionName: string;
  content: string;
  provider?: ToolStreamProvider;
  model?: string;
  mode?: "propose" | "selective" | "auto";
  maxIterations?: number;
  /** Title used when initializing the agent session. */
  sessionTitle?: string;
}

export interface CallbackStreamSummary {
  ok: boolean;
  provider: ToolStreamProvider;
  finalText: string;
  cancelled?: boolean;
  /** Set when an error escaped the generator. */
  error?: string;
  /** Stream id we'd attach to a turn, for logs / multi-tab dedup. */
  streamId: string;
}

export async function runToolStreamWithCallback(
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager,
  input: CallbackStreamInput,
  onEvent: (event: LoopEvent) => void,
  abortSignal?: AbortSignal
): Promise<CallbackStreamSummary> {
  if (!input?.content || typeof input.content !== "string") {
    throw new AppError("E_BAD_REQUEST", "content is required", 400);
  }
  if (!env.AGENT_SESSIONS) {
    throw new AppError("E_DO_BINDING_MISSING", "AGENT_SESSIONS binding required", 500);
  }

  const enabled = new Set(runtime.listPlugins().map((p) => p.id));
  const provider = selectProvider(env, enabled, input.provider);
  const streamId = `chat-ws-${crypto.randomUUID()}`;

  const sessionName = input.sessionName || CONDUCTOR_SESSION_DEFAULT;
  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);

  await stub.fetch(
    new Request("https://do/init", {
      method: "POST",
      body: JSON.stringify({ title: input.sessionTitle ?? "Streaming chat turn" })
    })
  );
  const history = await loadHistory(stub);
  await stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify({ role: "user", content: input.content })
    })
  );

  // Bridge an externally-supplied abortSignal with our own internal one,
  // so callers can't lose track of the controller and we can also abort
  // on internal errors.
  const abortController = new AbortController();
  let externalAbortHandler: (() => void) | null = null;
  if (abortSignal) {
    if (abortSignal.aborted) abortController.abort();
    externalAbortHandler = () => abortController.abort();
    abortSignal.addEventListener("abort", externalAbortHandler);
  }

  const systemPrompt = buildSystemPrompt(skills.listSkills(), input.mode ?? "selective");
  const baseConfig: ToolLoopConfig = {
    env,
    runtime,
    skillList: skills.listSkills(),
    systemPrompt,
    messages: toConversationHistory(history),
    userContent: input.content,
    model: input.model,
    maxIterations: input.maxIterations,
    mode: input.mode ?? "selective",
    abortSignal: abortController.signal
  };

  let finalText = "";
  let cancelled = false;
  let errorMsg: string | undefined;

  try {
    const generator = createGenerator(provider, env, baseConfig);
    for await (const event of generator) {
      onEvent(event);
      if (event.kind === "loop-done") {
        finalText = event.finalText;
        if (event.reason === "cancelled") cancelled = true;
      }
    }
    if (finalText) {
      await stub.fetch(
        new Request("https://do/messages", {
          method: "POST",
          body: JSON.stringify({
            role: "assistant",
            name: `${provider}:stream-tools`,
            content: finalText
          })
        })
      );
    }
  } catch (err) {
    const e = toAppError(err);
    errorMsg = e.message;
    onEvent({ kind: "error", message: e.message, code: e.code });
  } finally {
    if (externalAbortHandler && abortSignal) {
      abortSignal.removeEventListener("abort", externalAbortHandler);
    }
  }

  return {
    ok: !errorMsg && !cancelled,
    provider,
    finalText,
    cancelled: cancelled || undefined,
    error: errorMsg,
    streamId
  };
}

function toConversationHistory(
  history: SessionMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
