import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { rpcCall } from "../oauth/codexRpc";
import { enforceSpendingCap, recordSpend } from "../costTracking";
import { estimateCostUsd, extractOpenAIUsage } from "../costPricing";

/**
 * Codex plugin — connect OpenAI Codex with one of four auth modes.
 *
 *   1. `api-key`          — OPENAI_API_KEY; uses OpenAI Responses/Chat API.
 *   2. `chatgpt-tokens`   — CODEX_ACCESS_TOKEN (+ CODEX_ID_TOKEN) pasted from
 *                           `~/.codex/auth.json` after `codex login`. Routes
 *                           to chatgpt.com/backend-api/codex so calls bill
 *                           against your ChatGPT subscription.
 *   3. `app-server`       — CODEX_APP_SERVER_URL pointing at a running
 *                           `codex app-server --listen ws://host:port` (or an
 *                           HTTP shim). Full Codex thread/turn/model JSON-RPC.
 *                           See docs/CODEX_APPSERVER.md for deployment recipes.
 *   4. `oauth-device`     — roadmap via /oauth/codex/device/*.
 *
 * When multiple modes are configured, precedence is:
 *   app-server > api-key > chatgpt-tokens > unconfigured
 * The bias toward app-server reflects that it also handles OAuth + token
 * refresh on the host machine — the most correct subscription path.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }>;
  toolChoice?: "auto" | "required" | "none";
  threadId?: string;
}

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

type AuthMode = "app-server" | "api-key" | "chatgpt-tokens" | "unconfigured";

function parseMessage(raw: unknown, idx: number): ChatMessage {
  if (!raw || typeof raw !== "object") {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}] must be an object`, 400);
  }
  const m = raw as Record<string, unknown>;
  const role = m.role;
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}].role invalid`, 400);
  }
  const content = typeof m.content === "string" ? m.content : m.content === null ? null : "";
  const msg: ChatMessage = { role, content };
  if (typeof m.name === "string") msg.name = m.name;
  if (typeof m.tool_call_id === "string") msg.tool_call_id = m.tool_call_id;
  if (Array.isArray(m.tool_calls)) {
    msg.tool_calls = (m.tool_calls as unknown[]).map((tc, tci) => {
      const t = (tc ?? {}) as Record<string, unknown>;
      const fn = (t.function ?? {}) as Record<string, unknown>;
      return {
        id: String(t.id ?? `tc_${idx}_${tci}`),
        type: "function",
        function: {
          name: String(fn.name ?? ""),
          arguments:
            typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {})
        }
      };
    });
  }
  return msg;
}

function parseChat(input: unknown): ChatInput {
  if (!input || typeof input !== "object") {
    throw new AppError("E_BAD_REQUEST", "input must be an object with 'messages'", 400);
  }
  const c = input as Record<string, unknown>;
  if (!Array.isArray(c.messages) || c.messages.length === 0) {
    throw new AppError("E_BAD_REQUEST", "'messages' must be a non-empty array", 400);
  }
  return {
    messages: c.messages.map((m, idx) => parseMessage(m, idx)),
    model: typeof c.model === "string" ? c.model : undefined,
    maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : undefined,
    temperature: typeof c.temperature === "number" ? c.temperature : undefined,
    tools: Array.isArray(c.tools) ? (c.tools as ChatInput["tools"]) : undefined,
    toolChoice:
      c.toolChoice === "auto" || c.toolChoice === "required" || c.toolChoice === "none"
        ? c.toolChoice
        : undefined,
    threadId: typeof c.threadId === "string" ? c.threadId : undefined
  };
}

export class CodexPlugin implements AgentPlugin {
  readonly id = "codex";
  readonly version = "0.2.0";
  readonly description =
    "OpenAI Codex provider — API key, ChatGPT subscription tokens, or app-server bridge";
  readonly capabilities = ["models", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private authMode(): AuthMode {
    if (this.ctx?.env.CODEX_APP_SERVER_URL) return "app-server";
    if (this.ctx?.env.OPENAI_API_KEY) return "api-key";
    if (this.ctx?.env.CODEX_ACCESS_TOKEN) return "chatgpt-tokens";
    return "unconfigured";
  }

  private rpcOptions() {
    return {
      url: this.ctx!.env.CODEX_APP_SERVER_URL!,
      token: this.ctx!.env.CODEX_APP_SERVER_TOKEN,
      timeoutMs: Number(this.ctx!.env.CODEX_APP_SERVER_TIMEOUT_MS ?? 30000) || 30000,
      fetchImpl: this.ctx!.fetch
    };
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    try {
      if (action === "status") {
        const mode = this.authMode();
        const base: Record<string, unknown> = {
          provider: "codex",
          authMode: mode,
          hasApiKey: Boolean(this.ctx.env.OPENAI_API_KEY),
          hasChatGptTokens: Boolean(this.ctx.env.CODEX_ACCESS_TOKEN),
          hasIdToken: Boolean(this.ctx.env.CODEX_ID_TOKEN),
          hasAppServer: Boolean(this.ctx.env.CODEX_APP_SERVER_URL),
          appServerTransport: this.ctx.env.CODEX_APP_SERVER_URL?.startsWith("ws")
            ? "websocket"
            : this.ctx.env.CODEX_APP_SERVER_URL
              ? "http"
              : null,
          backendUrl: this.ctx.env.CODEX_BACKEND_URL ?? DEFAULT_CHATGPT_URL,
          notes: this.setupNotes()
        };
        if (mode === "app-server") {
          const probe = await this.rpcCallSafe("account/read");
          base.appServerProbe = probe;
        }
        return { ok: true, data: base };
      }

      if (action === "setup-instructions") {
        return {
          ok: true,
          data: {
            modes: [
              {
                id: "api-key",
                label: "OpenAI API key (classic)",
                how: "Set OPENAI_API_KEY to a key from https://platform.openai.com/api-keys. Billed at API rates.",
                tradeoff: "Standard API pricing, separate from any ChatGPT Plus/Pro subscription."
              },
              {
                id: "chatgpt-tokens",
                label: "ChatGPT subscription (paste tokens)",
                how: "Run `codex login` locally, then read `~/.codex/auth.json` and set CODEX_ACCESS_TOKEN (and CODEX_ID_TOKEN if present) as Worker secrets. Calls route to chatgpt.com/backend-api/codex and are billed against your ChatGPT Plus/Pro subscription.",
                tradeoff: "Tokens expire and must be refreshed periodically; the backend path is subject to change."
              },
              {
                id: "app-server",
                label: "Codex app-server bridge (recommended for subscriptions)",
                how: "Run `codex app-server --listen ws://127.0.0.1:4500` locally and expose it via cloudflared tunnel, OR deploy a companion Sandbox Worker (see docs/CODEX_APPSERVER.md). Set CODEX_APP_SERVER_URL to the reachable URL. The app-server owns OAuth + token refresh for you.",
                tradeoff: "Requires running the codex CLI somewhere the Worker can reach via HTTPS/WSS."
              },
              {
                id: "oauth-device",
                label: "Device code OAuth (roadmap)",
                how: "Use POST /oauth/codex/device/start and /oauth/codex/device/poll once the registered OpenAI OAuth client ID is provisioned.",
                tradeoff: "Future path — requires registering Open Think as an OpenAI OAuth app."
              }
            ]
          }
        };
      }

      if (action === "chat") {
        const parsed = parseChat(input);
        const mode = this.authMode();
        if (mode === "unconfigured") {
          return {
            ok: false,
            error:
              "codex plugin is unconfigured. Set OPENAI_API_KEY, CODEX_ACCESS_TOKEN, or CODEX_APP_SERVER_URL (see codex:setup-instructions)."
          };
        }
        // Pre-call cap check, applied to every codex auth path.
        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }
        const result =
          mode === "app-server"
            ? await this.chatViaAppServer(parsed)
            : mode === "api-key"
              ? await this.chatViaApiKey(parsed)
              : await this.chatViaChatGpt(parsed);
        if (result.ok) {
          // All three paths return either a Responses-API or Chat-Completions
          // shape; both expose `usage` somewhere extractOpenAIUsage finds.
          const usage = extractOpenAIUsage(result.data);
          await recordSpend(this.ctx.env, {
            provider: "codex",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd: estimateCostUsd(parsed.model, usage.promptTokens, usage.completionTokens)
          }).catch(() => {
            /* never fail the user-visible call on accounting hiccup */
          });
        }
        return result;
      }

      if (action === "thread-start") {
        if (this.authMode() !== "app-server") {
          return { ok: false, error: "thread-start requires CODEX_APP_SERVER_URL" };
        }
        const title = typeof (input as { title?: string } | null)?.title === "string"
          ? (input as { title: string }).title
          : undefined;
        const response = await rpcCall(this.rpcOptions(), {
          method: "thread/start",
          params: { title }
        });
        return this.mapRpc(response);
      }

      if (action === "thread-list") {
        if (this.authMode() !== "app-server") {
          return { ok: false, error: "thread-list requires CODEX_APP_SERVER_URL" };
        }
        const response = await rpcCall(this.rpcOptions(), {
          method: "thread/list",
          params: {}
        });
        return this.mapRpc(response);
      }

      if (action === "models") {
        if (this.authMode() !== "app-server") {
          return {
            ok: false,
            error:
              "models requires CODEX_APP_SERVER_URL (use openai-compatible:list-models or cf-gateway-list-providers otherwise)"
          };
        }
        const response = await rpcCall(this.rpcOptions(), {
          method: "model/list",
          params: {}
        });
        return this.mapRpc(response);
      }

      if (action === "rpc") {
        if (this.authMode() !== "app-server") {
          return { ok: false, error: "rpc requires CODEX_APP_SERVER_URL" };
        }
        if (!input || typeof input !== "object") {
          return { ok: false, error: "rpc expects { method, params? }" };
        }
        const c = input as Record<string, unknown>;
        if (typeof c.method !== "string") {
          return { ok: false, error: "rpc.method must be a string" };
        }
        const response = await rpcCall(this.rpcOptions(), {
          method: c.method,
          params: c.params,
          id: c.id as string | number | undefined
        });
        return this.mapRpc(response);
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async rpcCallSafe(method: string, params?: unknown): Promise<unknown> {
    try {
      const response = await rpcCall(this.rpcOptions(), { method, params });
      return { ok: !response.error, error: response.error, result: response.result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private mapRpc(response: { result?: unknown; error?: { message: string; code: number } }): PluginResult {
    if (response.error) {
      return { ok: false, error: `app-server rpc error ${response.error.code}: ${response.error.message}` };
    }
    return { ok: true, data: { mode: "app-server", result: response.result } };
  }

  private setupNotes(): string {
    const mode = this.authMode();
    if (mode === "app-server") {
      return "Using app-server bridge. Thread/turn/model JSON-RPC routes through your running codex app-server.";
    }
    if (mode === "api-key") return "Using OPENAI_API_KEY — billed at standard API rates.";
    if (mode === "chatgpt-tokens") {
      return "Using pasted ChatGPT tokens. Tokens expire; re-run `codex login` locally and refresh the Worker secrets when calls start failing.";
    }
    return "Unconfigured. Run codex:setup-instructions for guidance.";
  }

  private async chatViaAppServer(parsed: ChatInput): Promise<PluginResult> {
    const lastUser = [...parsed.messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content) {
      return { ok: false, error: "app-server chat needs at least one user message with content" };
    }

    let threadId = parsed.threadId;
    if (!threadId) {
      const start = await rpcCall<{ thread_id?: string; id?: string }>(this.rpcOptions(), {
        method: "thread/start",
        params: { title: "open-think session" }
      });
      if (start.error) {
        return { ok: false, error: `thread/start failed: ${start.error.message}` };
      }
      threadId = start.result?.thread_id ?? start.result?.id;
      if (!threadId) {
        return { ok: false, error: "thread/start returned no thread id" };
      }
    }

    const turn = await rpcCall<{ turn_id?: string; output?: unknown }>(this.rpcOptions(), {
      method: "turn/start",
      params: {
        thread_id: threadId,
        input: lastUser.content,
        model: parsed.model,
        tools: parsed.tools,
        tool_choice: parsed.toolChoice
      }
    });
    if (turn.error) {
      return { ok: false, error: `turn/start failed: ${turn.error.message}` };
    }
    return {
      ok: true,
      data: {
        mode: "app-server",
        threadId,
        turn: turn.result
      }
    };
  }

  private async chatViaApiKey(parsed: ChatInput): Promise<PluginResult> {
    const apiKey = this.ctx!.env.OPENAI_API_KEY!;
    const url = `${DEFAULT_OPENAI_URL}/chat/completions`;
    const body: Record<string, unknown> = {
      model: parsed.model ?? "gpt-5-codex",
      messages: parsed.messages
    };
    if (parsed.maxTokens !== undefined) body.max_tokens = parsed.maxTokens;
    if (parsed.temperature !== undefined) body.temperature = parsed.temperature;
    if (parsed.tools && parsed.tools.length > 0) {
      body.tools = parsed.tools;
      body.tool_choice = parsed.toolChoice ?? "auto";
    }

    const response = await this.ctx!.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `OpenAI API error ${response.status}: ${text.slice(0, 500)}` };
    }
    try {
      return { ok: true, data: { mode: "api-key", response: JSON.parse(text) } };
    } catch {
      return { ok: true, data: { mode: "api-key", response: text } };
    }
  }

  private async chatViaChatGpt(parsed: ChatInput): Promise<PluginResult> {
    const accessToken = this.ctx!.env.CODEX_ACCESS_TOKEN!;
    const base = this.ctx!.env.CODEX_BACKEND_URL ?? DEFAULT_CHATGPT_URL;
    const url = `${base.replace(/\/$/, "")}/responses`;
    const body: Record<string, unknown> = {
      model: parsed.model ?? "gpt-5-codex",
      input: parsed.messages
    };
    if (parsed.maxTokens !== undefined) body.max_output_tokens = parsed.maxTokens;
    if (parsed.temperature !== undefined) body.temperature = parsed.temperature;
    if (parsed.tools && parsed.tools.length > 0) {
      body.tools = parsed.tools;
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "openai-beta": "codex-2025"
    };
    if (this.ctx!.env.CODEX_ID_TOKEN) {
      headers["x-codex-id-token"] = this.ctx!.env.CODEX_ID_TOKEN;
    }

    const response = await this.ctx!.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: `Codex tokens rejected (${response.status}). Re-run \`codex login\` locally and refresh CODEX_ACCESS_TOKEN + CODEX_ID_TOKEN secrets.`
      };
    }
    if (!response.ok) {
      return { ok: false, error: `Codex backend error ${response.status}: ${text.slice(0, 500)}` };
    }
    try {
      return { ok: true, data: { mode: "chatgpt-tokens", response: JSON.parse(text) } };
    } catch {
      return { ok: true, data: { mode: "chatgpt-tokens", response: text } };
    }
  }
}
