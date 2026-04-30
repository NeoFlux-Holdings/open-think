/**
 * OpenRouter plugin — first-class provider for OpenRouter (openrouter.ai).
 *
 * OpenRouter exposes an OpenAI-compatible /chat/completions endpoint that
 * routes to whichever model id you pick — including their `openrouter/auto`
 * router which selects a model based on the prompt/cost. Great default
 * because the user gets sensible model selection for free.
 *
 * This plugin is functionally similar to OpenAICompatiblePlugin, but with:
 *   - Hardcoded base URL (so user only needs to set OPENROUTER_API_KEY)
 *   - Default model = "openrouter/auto" (overridable via OPENROUTER_DEFAULT_MODEL)
 *   - Attribution headers (HTTP-Referer + X-Title) per OR's recommendations
 *
 * Conductor's pickProvider gives openrouter the highest priority when set,
 * unless the user overrides with `provider:` in their request.
 *
 * Streaming + tool use go through the same OpenAI-compatible streaming
 * adapter (src/openai-stream.ts) — see conductor-tool-stream.ts for the
 * runtime config it builds when provider === "openrouter".
 */

import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { enforceSpendingCap, recordSpend } from "../costTracking";
import { estimateCostUsd, extractOpenAIUsage } from "../costPricing";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "openrouter/auto";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  toolChoice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
}

function parseMessage(raw: unknown, idx: number): ChatMessage {
  if (!raw || typeof raw !== "object") {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}] must be an object`, 400);
  }
  const m = raw as Record<string, unknown>;
  const role = m.role;
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    throw new AppError(
      "E_BAD_REQUEST",
      `messages[${idx}].role must be one of system|user|assistant|tool`,
      400
    );
  }
  const content = typeof m.content === "string" ? m.content : m.content === null ? null : "";
  const msg: ChatMessage = { role, content };
  if (typeof m.name === "string") msg.name = m.name;
  if (typeof m.tool_call_id === "string") msg.tool_call_id = m.tool_call_id;
  const tcRaw = m.tool_calls;
  if (Array.isArray(tcRaw)) {
    msg.tool_calls = tcRaw.map((tc, tci) => {
      if (!tc || typeof tc !== "object") {
        throw new AppError("E_BAD_REQUEST", `messages[${idx}].tool_calls[${tci}] must be an object`, 400);
      }
      const t = tc as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      return {
        id: String(t.id ?? `tc_${idx}_${tci}`),
        type: "function",
        function: {
          name: String(fn?.name ?? ""),
          arguments: typeof fn?.arguments === "string" ? fn.arguments : JSON.stringify(fn?.arguments ?? {})
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
  const messages = c.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError("E_BAD_REQUEST", "'messages' must be a non-empty array", 400);
  }
  const normalized = messages.map((raw, idx) => parseMessage(raw, idx));
  const toolsRaw = c.tools;
  const tools = Array.isArray(toolsRaw)
    ? (toolsRaw as OpenAITool[]).filter(
        (t) => t && t.type === "function" && t.function && typeof t.function.name === "string"
      )
    : undefined;
  const toolChoiceRaw = c.toolChoice ?? c.tool_choice;
  let toolChoice: ChatInput["toolChoice"] | undefined;
  if (toolChoiceRaw === "auto" || toolChoiceRaw === "required" || toolChoiceRaw === "none") {
    toolChoice = toolChoiceRaw;
  } else if (
    toolChoiceRaw &&
    typeof toolChoiceRaw === "object" &&
    (toolChoiceRaw as { type?: string }).type === "function"
  ) {
    toolChoice = toolChoiceRaw as ChatInput["toolChoice"];
  }
  return {
    messages: normalized,
    model: typeof c.model === "string" ? c.model : undefined,
    maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : undefined,
    temperature: typeof c.temperature === "number" ? c.temperature : undefined,
    stream: Boolean(c.stream),
    tools,
    toolChoice
  };
}

export class OpenRouterPlugin implements AgentPlugin {
  readonly id = "openrouter";
  readonly version = "0.1.0";
  readonly description =
    "OpenRouter — one API for 100+ providers, with an `openrouter/auto` router that picks a model per prompt.";
  readonly capabilities = ["models", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private resolveBaseUrl(): string {
    const raw = this.ctx?.env.OPENROUTER_BASE_URL?.trim();
    return (raw && raw.length > 0 ? raw : OPENROUTER_DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private resolveDefaultModel(): string {
    return (
      this.ctx?.env.OPENROUTER_DEFAULT_MODEL?.trim() ||
      this.ctx?.config.modelDefault ||
      OPENROUTER_DEFAULT_MODEL
    );
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.ctx?.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new AppError(
        "E_OPENROUTER_KEY_MISSING",
        "OPENROUTER_API_KEY is not set. Get one at https://openrouter.ai/settings/keys.",
        400
      );
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    };
    // OpenRouter recommends both attribution headers — they show up in the
    // dashboard so users know which app made which call.
    const referer = this.ctx?.env.OPENROUTER_HTTP_REFERER?.trim();
    if (referer) headers["HTTP-Referer"] = referer;
    const title = this.ctx?.env.OPENROUTER_X_TITLE?.trim() || "Open Think Helm";
    headers["X-Title"] = title;
    return headers;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) return { ok: false, error: "Plugin not initialized" };

    try {
      if (action === "status") {
        return {
          ok: true,
          data: {
            provider: "openrouter",
            baseUrl: this.resolveBaseUrl(),
            hasKey: Boolean(this.ctx.env.OPENROUTER_API_KEY),
            modelDefault: this.resolveDefaultModel()
          }
        };
      }

      if (action === "list-models") {
        const url = `${this.resolveBaseUrl()}/models`;
        const headers = this.buildHeaders();
        const response = await this.ctx.fetch(url, { method: "GET", headers });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `OpenRouter ${response.status}: ${text.slice(0, 500)}` };
        }
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch {
          return { ok: true, data: { raw: text } };
        }
      }

      if (action === "chat") {
        const parsed = parseChat(input);

        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }

        const model = parsed.model ?? this.resolveDefaultModel();
        const body: Record<string, unknown> = {
          model,
          messages: parsed.messages
        };
        if (parsed.maxTokens !== undefined) body.max_tokens = parsed.maxTokens;
        if (parsed.temperature !== undefined) body.temperature = parsed.temperature;
        if (parsed.stream) body.stream = true;
        if (parsed.tools && parsed.tools.length > 0) {
          body.tools = parsed.tools;
          body.tool_choice = parsed.toolChoice ?? "auto";
        }

        const response = await this.ctx.fetch(`${this.resolveBaseUrl()}/chat/completions`, {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body)
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `OpenRouter ${response.status}: ${text.slice(0, 500)}` };
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          return { ok: true, data: { model, response: text } };
        }
        const usage = extractOpenAIUsage(parsedJson);
        await recordSpend(this.ctx.env, {
          provider: "openrouter",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          // OR returns x-or-cost in headers + sometimes inline; we approximate
          // via our generic estimate for now. Future: read OR's native cost.
          costUsd: estimateCostUsd(model, usage.promptTokens, usage.completionTokens)
        }).catch(() => {});
        return { ok: true, data: { model, response: parsedJson } };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
