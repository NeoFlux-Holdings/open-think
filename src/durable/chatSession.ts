/**
 * ChatSessionDO — WebSocket-based chat session for /app's Helm tab.
 *
 * One DO instance per session name (e.g. "conductor:default"). Holds the
 * WebSocket connections from each browser tab watching that session. Uses
 * Cloudflare's Hibernation API (`state.acceptWebSocket()`) so idle
 * connections cost nothing.
 *
 * Protocol (JSON over WS):
 *
 *   Client → Server:
 *     { kind: "user-message", content, mode?, provider?, model? }
 *     { kind: "interrupt" }                  // halt current turn
 *     { kind: "ping" }                       // keepalive
 *
 *   Server → Client:
 *     { kind: "ready", sessionName }         // sent on connect
 *     { kind: "thinking" }                   // received user-message, working on it
 *     { kind: "user-message", message }      // echo so other tabs see it
 *     { kind: "assistant-message", message } // final response
 *     { kind: "halted", reason }             // selective mode hit a dangerous skill
 *     { kind: "error", message }             // turn failed
 *     { kind: "complete", durationMs }       // turn finished (success or fail)
 *     { kind: "pong" }
 *
 * Multi-tab: every event the server sends fans out to ALL connected sockets
 * for this session. Two browser tabs on the same session see each other's
 * messages — same Helm session, two windows.
 *
 * Architecture vs. existing /conductor/message + /conductor/stream:
 *   - POST /conductor/message — one fetch per turn, response in body
 *   - SSE /conductor/stream    — streaming token deltas via codex app-server
 *   - WS  /chat/ws/<session>   — persistent connection, bidirectional, multi-tab
 *
 * V1 routes user-messages to handleConductorMessage (one-shot reply, all
 * three modes propose/selective/auto). V2 will pipe handleConductorTool-
 * Stream's token deltas through this same WS for live token streaming.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import { AgentRuntime } from "../core/runtime";
import { SkillManager } from "../core/skills";
import { getPlugins } from "../plugins/registry";
import { handleConductorMessage, normalizeMode } from "../conductor";
import { runToolStreamWithCallback } from "../conductor-tool-stream";

interface ClientCommand {
  kind: "user-message" | "interrupt" | "ping";
  content?: string;
  mode?: "propose" | "selective" | "auto";
  provider?: string;
  model?: string;
  /** Round-trip-able id so the originating tab can dedupe its own echo. */
  clientMessageId?: string;
}

export class ChatSessionDO extends DurableObject<Env> {
  // ctx.acceptWebSocket() and ctx.getWebSockets() are the Hibernation API
  // entrypoints. We track per-socket attachments via ws.serializeAttachment
  // for any state we need to survive hibernation (currently just the
  // session name we extracted from the URL on first connect).

  /** Lazily-bootstrapped runtime + skills, kept alive while DO is awake. */
  private runtime: AgentRuntime | null = null;
  private skills: SkillManager | null = null;

  /** Per-turn AbortController. Set when a streaming turn starts; aborted
   *  on receipt of an "interrupt" command, stopping the upstream provider
   *  fetch cleanly. Null when no turn is in flight. */
  private activeAbortController: AbortController | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgrade = request.headers.get("upgrade")?.toLowerCase() ?? "";

    if (upgrade !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const sessionName = url.searchParams.get("session") ?? "conductor:default";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API — DO can be evicted while sockets stay open. When a
    // message arrives, the runtime re-instantiates the DO and calls
    // webSocketMessage(). State that needs to survive hibernation goes
    // into ws.serializeAttachment().
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionName, connectedAt: Date.now() });

    // Greet the new connection.
    server.send(
      JSON.stringify({ kind: "ready", sessionName, time: new Date().toISOString() })
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(raw) as ClientCommand;
    } catch {
      ws.send(JSON.stringify({ kind: "error", message: "invalid JSON command" }));
      return;
    }

    if (cmd.kind === "ping") {
      ws.send(JSON.stringify({ kind: "pong" }));
      return;
    }

    if (cmd.kind === "interrupt") {
      // Real interrupt — aborts the AbortController bound to the active
      // streaming turn. The upstream provider fetch sees the signal,
      // throws AbortError, and the loop emits loop-done {reason: "cancelled"}
      // → DO broadcasts halted + a final cancelled assistant-message.
      if (this.activeAbortController) {
        this.activeAbortController.abort();
        this.broadcast({ kind: "halted", reason: "interrupted by user" });
      } else {
        this.broadcast({ kind: "halted", reason: "no active turn to interrupt" });
      }
      return;
    }

    if (cmd.kind === "user-message") {
      await this.handleUserMessage(ws, cmd);
      return;
    }

    ws.send(JSON.stringify({ kind: "error", message: `unknown command kind: ${String(cmd.kind)}` }));
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // No-op — getWebSockets() automatically excludes closed sockets.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // No-op — same as close.
  }

  /* ---------------- private ---------------- */

  private async ensureBootstrap(): Promise<{ runtime: AgentRuntime; skills: SkillManager }> {
    if (this.runtime && this.skills) return { runtime: this.runtime, skills: this.skills };
    this.runtime = await AgentRuntime.bootstrap(this.env, getPlugins());
    this.skills = new SkillManager(this.runtime);
    return { runtime: this.runtime, skills: this.skills };
  }

  private async handleUserMessage(ws: WebSocket, cmd: ClientCommand): Promise<void> {
    const content = (cmd.content ?? "").trim();
    if (!content) {
      ws.send(JSON.stringify({ kind: "error", message: "content is empty" }));
      return;
    }
    const attachment = ws.deserializeAttachment() as { sessionName?: string } | null;
    const sessionName = attachment?.sessionName ?? "conductor:default";

    // Echo the user message to all connected tabs (so multi-window works).
    // The originating tab sees this echo and dedupes via clientMessageId.
    this.broadcast({
      kind: "user-message",
      message: {
        role: "user",
        content,
        sessionName,
        clientMessageId: cmd.clientMessageId,
        ts: new Date().toISOString()
      }
    });

    this.broadcast({ kind: "thinking", sessionName });

    const mode = normalizeMode(cmd.mode);
    const startedAt = Date.now();
    // Spin up an AbortController for this turn so a subsequent interrupt
    // command can cancel the upstream provider fetch mid-stream.
    this.activeAbortController = new AbortController();
    try {
      const { runtime, skills } = await this.ensureBootstrap();
      if (mode === "execute") {
        // Streaming tool-use loop. Every LoopEvent (text-delta, tool-use-*,
        // turn-stop, loop-done, etc.) flows out over the WS as its own
        // frame so the UI can render incrementally. The final assistant
        // message is also sent for history-rendering convenience.
        let finalText = "";
        const result = await runToolStreamWithCallback(
          this.env,
          runtime,
          skills,
          {
            sessionName,
            content,
            mode: "auto",
            provider: cmd.provider as never,
            model: cmd.model
          },
          (event) => {
            this.broadcast(event as unknown as Record<string, unknown>);
            if (event.kind === "text-delta") finalText += event.text;
            if (event.kind === "loop-done") finalText = event.finalText;
          },
          this.activeAbortController?.signal
        );
        this.broadcast({
          kind: "assistant-message",
          message: {
            role: "assistant",
            content: result.finalText || finalText || "(no output)",
            sessionName,
            mode: "execute",
            provider: result.provider,
            ts: new Date().toISOString(),
            ...(result.cancelled ? { halted: "cancelled" } : {})
          }
        });
        if (result.cancelled) {
          this.broadcast({ kind: "halted", reason: "cancelled by user" });
        }
        if (result.error) {
          this.broadcast({ kind: "error", message: result.error });
        }
      } else {
        // Plan mode: one-shot reply describing the approach. No skill calls.
        // Routes through handleConductorMessage with internal "propose"
        // semantics so the model is asked to describe (not execute) — the
        // frontend renders the assistant text as plain markdown without
        // any action cards.
        const reply = await handleConductorMessage(this.env, runtime, skills, {
          sessionName,
          content,
          mode: "propose",
          provider: cmd.provider as never,
          model: cmd.model
        });
        this.broadcast({
          kind: "assistant-message",
          message: {
            role: "assistant",
            content: reply.assistantMessage?.content ?? "(empty reply)",
            sessionName,
            mode: "plan",
            provider: reply.providerUsed,
            ts: new Date().toISOString()
            // Drop suggestedActions / trace / iteration counts — plan mode
            // is conversational. The proposal-card UI is gone.
          }
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.broadcast({ kind: "error", message });
    } finally {
      this.activeAbortController = null;
      this.broadcast({ kind: "complete", durationMs: Date.now() - startedAt });
    }
  }

  /** Send `event` (JSON-serialized) to every WS attached to this DO. */
  private broadcast(event: Record<string, unknown>): void {
    const frame = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        // 1 === WebSocket.OPEN. Hibernated sockets report 1 when usable.
        if (ws.readyState === 1) {
          ws.send(frame);
        }
      } catch {
        // Connection went away mid-broadcast; ignore.
      }
    }
  }
}
