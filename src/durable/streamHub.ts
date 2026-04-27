import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import { AppError, toAppError } from "../core/errors";
import { rpcCall, rpcStream, type CodexRpcOptions } from "../oauth/codexRpc";
import { EventBus } from "./eventBus";

/**
 * One StreamHubDO instance === one active streaming turn (named by an outer stream id).
 *
 * Architecture:
 *   - DO owns a single upstream WebSocket to the codex app-server for the turn's duration.
 *   - Frames from the upstream fan out to N SSE subscribers via EventBus with a 500-frame
 *     replay buffer, so a browser tab that joins mid-turn gets caught up.
 *   - `turn/interrupt` is delivered via a **second, short-lived** WebSocket so we don't
 *     disturb the primary rpcStream generator's id-matched termination logic.
 *   - After the terminal frame, the DO retires: upstream closes, subscribers close,
 *     a final `done` event goes out.
 *
 * Why a DO (vs. inline Worker handler):
 *   - Multiple browser tabs can watch the same turn (multi-sub).
 *   - Browser refresh mid-turn doesn't drop the upstream connection.
 *   - Bounded replay buffer lives at the right scope.
 *
 * Lifetime: roughly the duration of one LLM turn (seconds to a minute). DO hibernates
 * when idle but we don't need to persist state across hibernation since each turn is
 * ephemeral — `state` is held in memory only.
 */

interface StreamInit {
  id: string;
  sessionName: string;
  content: string;
  model?: string;
  mode?: string;
  upstreamUrl: string;
  upstreamToken?: string;
  upstreamTimeoutMs?: number;
  systemPrompt?: string;
  threadId?: string;
}

interface RuntimeState extends StreamInit {
  createdAt: string;
  status: "pending" | "streaming" | "done" | "error" | "cancelled";
  turnId?: string;
  resolvedThreadId?: string;
  finalText?: string;
  errorMessage?: string;
}

const BUFFER_LIMIT = 500;

export class StreamHubDO extends DurableObject<Env> {
  private bus = new EventBus({ bufferLimit: BUFFER_LIMIT });
  private state: RuntimeState | null = null;
  private active = false;
  private interruptRequested = false;
  private interruptReason: string | null = null;

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "POST" && path === "/init") {
        return this.handleInit(request);
      }
      if (request.method === "GET" && path === "/subscribe") {
        return this.handleSubscribe();
      }
      if (request.method === "POST" && path === "/interrupt") {
        return this.handleInterrupt(request);
      }
      if (request.method === "GET" && path === "/state") {
        return this.jsonResponse({ ok: true, data: this.snapshotState() });
      }
      if (request.method === "DELETE" && path === "/") {
        await this.bus.close({ event: "done", data: { reason: "shutdown" } });
        this.state = null;
        return this.jsonResponse({ ok: true, data: { closed: true } });
      }
      return this.jsonResponse({ ok: false, error: "not found", code: "E_NOT_FOUND" }, 404);
    } catch (err) {
      const e = toAppError(err);
      return this.jsonResponse({ ok: false, error: e.message, code: e.code }, e.status);
    }
  }

  private async handleInit(request: Request): Promise<Response> {
    if (this.state) {
      return this.jsonResponse(
        { ok: false, error: "stream already initialized", code: "E_ALREADY_INITIALIZED" },
        409
      );
    }
    const body = (await request.json()) as StreamInit;
    if (!body?.id || !body.upstreamUrl || !body.content) {
      return this.jsonResponse(
        { ok: false, error: "id, upstreamUrl, and content are required", code: "E_BAD_REQUEST" },
        400
      );
    }

    const initState: RuntimeState = {
      ...body,
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    this.state = initState;
    this.ctx.waitUntil(this.runTurn(initState));

    return this.jsonResponse({
      ok: true,
      data: { id: body.id, status: "pending", createdAt: initState.createdAt }
    });
  }

  private async handleSubscribe(): Promise<Response> {
    if (!this.state) {
      return this.jsonResponse(
        { ok: false, error: "stream not initialized", code: "E_NOT_INITIALIZED" },
        404
      );
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const subId = crypto.randomUUID();
    const encoder = new TextEncoder();

    await writer
      .write(
        encoder.encode(
          `event: ready\ndata: ${JSON.stringify({
            streamId: this.state.id,
            subscriberId: subId,
            status: this.state.status
          })}\n\n`
        )
      )
      .catch(() => undefined);

    this.bus.subscribe(subId, writer);

    return new Response(readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
        "x-stream-id": this.state.id,
        "x-subscriber-id": subId
      }
    });
  }

  private async handleInterrupt(request: Request): Promise<Response> {
    if (!this.state) {
      return this.jsonResponse(
        { ok: false, error: "stream not initialized", code: "E_NOT_INITIALIZED" },
        404
      );
    }
    if (!this.active) {
      return this.jsonResponse({
        ok: true,
        data: { status: this.state.status, reason: "turn already finished" }
      });
    }

    let reason = "user-requested";
    try {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      if (typeof body?.reason === "string" && body.reason.length > 0) reason = body.reason;
    } catch {
      // ignore parse errors
    }

    this.interruptRequested = true;
    this.interruptReason = reason;

    const turnId = this.state.turnId;
    if (turnId) {
      try {
        await rpcCall(this.rpcOptions(), {
          method: "turn/interrupt",
          params: { turn_id: turnId }
        });
      } catch (err) {
        // best-effort — the rpcStream generator will still see the terminal frame
        this.bus.publish("notification", {
          method: "codex-bridge/interrupt-error",
          params: { message: (err as Error).message }
        });
      }
    }

    this.bus.publish("cancelled", { reason, turnId });
    return this.jsonResponse({
      ok: true,
      data: { status: "cancelling", turnId, reason }
    });
  }

  private async runTurn(state: RuntimeState): Promise<void> {
    this.active = true;
    this.state = { ...state, status: "streaming" };
    try {
      let threadId = state.threadId;
      if (!threadId) {
        const threadStart = await rpcCall<{ thread_id?: string; id?: string }>(this.rpcOptions(), {
          method: "thread/start",
          params: { title: "open-think streaming turn" }
        });
        if (threadStart.error) {
          throw new AppError(
            "E_THREAD_START_FAILED",
            `thread/start failed: ${threadStart.error.message}`,
            502
          );
        }
        threadId = threadStart.result?.thread_id ?? threadStart.result?.id;
        if (!threadId) {
          throw new AppError("E_THREAD_START_FAILED", "thread/start returned no thread id", 502);
        }
      }
      this.state.resolvedThreadId = threadId;
      this.bus.publish("thread", { threadId });

      const params: Record<string, unknown> = {
        thread_id: threadId,
        input: state.content
      };
      if (state.model) params.model = state.model;
      if (state.systemPrompt) params.system_prompt = state.systemPrompt;

      const assistantChunks: string[] = [];

      for await (const frame of rpcStream(this.rpcOptions(), {
        method: "turn/start",
        params
      })) {
        if (this.interruptRequested && !this.active) break;

        if (frame.method) {
          this.bus.publish("notification", { method: frame.method, params: frame.params });
          if (typeof frame.params === "object" && frame.params !== null) {
            const p = frame.params as Record<string, unknown>;
            if (typeof p.turn_id === "string" && !this.state.turnId) {
              this.state.turnId = p.turn_id;
            }
            if (frame.method === "turn/delta" || frame.method === "turn/text") {
              const text = typeof p.text === "string" ? p.text : typeof p.delta === "string" ? p.delta : "";
              if (text) assistantChunks.push(text);
            }
          }
        } else if (frame.error) {
          this.state.status = "error";
          this.state.errorMessage = frame.error.message;
          this.bus.publish("error", frame.error);
          break;
        } else if (frame.result !== undefined) {
          this.bus.publish("result", frame.result);
          const finalText = extractFinalText(frame.result) ?? assistantChunks.join("");
          if (finalText) {
            this.state.finalText = finalText;
            await this.persistAssistant(finalText);
          }
          this.state.status = this.interruptRequested ? "cancelled" : "done";
          break;
        }
      }

      if (this.state.status === "streaming") {
        this.state.status = this.interruptRequested ? "cancelled" : "done";
      }
    } catch (err) {
      const e = toAppError(err);
      if (this.state) {
        this.state.status = "error";
        this.state.errorMessage = e.message;
      }
      this.bus.publish("error", { code: e.code, message: e.message });
    } finally {
      this.active = false;
      await this.bus.close({
        event: "done",
        data: {
          status: this.state?.status ?? "error",
          reason: this.interruptReason ?? undefined,
          finalText: this.state?.finalText ?? null
        }
      });
    }
  }

  private async persistAssistant(text: string): Promise<void> {
    if (!this.env.AGENT_SESSIONS || !this.state?.sessionName) return;
    try {
      const doId = this.env.AGENT_SESSIONS.idFromName(this.state.sessionName);
      const stub = this.env.AGENT_SESSIONS.get(doId);
      await stub.fetch(
        new Request("https://do/messages", {
          method: "POST",
          body: JSON.stringify({
            role: "assistant",
            name: "codex:app-server-stream",
            content: text
          })
        })
      );
    } catch {
      // non-fatal — session persistence shouldn't break the stream
    }
  }

  private rpcOptions(): CodexRpcOptions {
    if (!this.state) {
      throw new AppError("E_NOT_INITIALIZED", "stream state not initialized", 500);
    }
    return {
      url: this.state.upstreamUrl,
      token: this.state.upstreamToken,
      timeoutMs: this.state.upstreamTimeoutMs ?? 120000
    };
  }

  private snapshotState() {
    if (!this.state) return { initialized: false };
    return {
      initialized: true,
      id: this.state.id,
      sessionName: this.state.sessionName,
      status: this.state.status,
      threadId: this.state.resolvedThreadId ?? this.state.threadId,
      turnId: this.state.turnId,
      subscribers: this.bus.subscriberCount(),
      bufferedEvents: this.bus.bufferedEvents().length,
      finalText: this.state.finalText ?? null,
      errorMessage: this.state.errorMessage ?? null,
      createdAt: this.state.createdAt
    };
  }

  private jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}

function extractFinalText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const output = r.output;
  if (Array.isArray(output)) {
    return output
      .map((block) => {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") return b.text;
        }
        return "";
      })
      .join("");
  }
  if (typeof r.text === "string") return r.text;
  return null;
}
