import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { enforceSpendingCap, recordSpend } from "../costTracking";
import { estimateCostUsd, extractOpenAIUsage } from "../costPricing";

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

  if (role !== "assistant" && role !== "tool" && typeof m.content !== "string") {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}].content must be a string`, 400);
  }
  if (role !== "assistant" && typeof m.content === "string" && m.content.length === 0) {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}].content must be non-empty`, 400);
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
        (t) =>
          t &&
          t.type === "function" &&
          t.function &&
          typeof t.function.name === "string"
      )
    : undefined;

  const toolChoiceRaw = c.toolChoice ?? c.tool_choice;
  let toolChoice: ChatInput["toolChoice"] | undefined;
  if (
    toolChoiceRaw === "auto" ||
    toolChoiceRaw === "required" ||
    toolChoiceRaw === "none"
  ) {
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

export class OpenAICompatiblePlugin implements AgentPlugin {
  readonly id = "openai-compatible";
  readonly version = "0.2.0";
  readonly description =
    "OpenAI-compatible chat completions with tool-use support (Groq, Together, Ollama, etc.)";
  readonly capabilities = ["models", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.ctx = context;
  }

  private resolveConfig(overrideUrl?: string): { url: string; apiKey: string | undefined } {
    const url = overrideUrl ?? this.ctx?.env.OPENAI_COMPATIBLE_URL;
    if (!url) {
      throw new AppError(
        "E_OAI_URL_MISSING",
        "baseUrl not provided and OPENAI_COMPATIBLE_URL env var is not set",
        400
      );
    }
    return { url, apiKey: this.ctx?.env.OPENAI_COMPATIBLE_KEY };
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx) {
      return { ok: false, error: "Plugin not initialized" };
    }

    try {
      if (action === "status") {
        return {
          ok: true,
          data: {
            provider: "openai-compatible",
            baseUrl: this.ctx.env.OPENAI_COMPATIBLE_URL ?? null,
            hasKey: Boolean(this.ctx.env.OPENAI_COMPATIBLE_KEY),
            modelDefault: this.ctx.config.modelDefault
          }
        };
      }

      if (action === "list-models") {
        const override =
          typeof (input as Record<string, unknown> | null)?.baseUrl === "string"
            ? ((input as Record<string, unknown>).baseUrl as string)
            : undefined;
        const { url, apiKey } = this.resolveConfig(override);
        const response = await this.ctx.fetch(`${url.replace(/\/$/, "")}/models`, {
          method: "GET",
          headers: apiKey
            ? { Authorization: `Bearer ${apiKey}`, accept: "application/json" }
            : { accept: "application/json" }
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `Upstream error ${response.status}: ${text.slice(0, 500)}` };
        }
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch {
          return { ok: true, data: { raw: text } };
        }
      }

      if (action === "chat") {
        const parsed = parseChat(input);

        // Pre-call: refuse if today's USD spend already crossed the cap.
        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }

        const { url, apiKey } = this.resolveConfig();
        const model = parsed.model ?? this.ctx.config.modelDefault;
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

        const response = await this.ctx.fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify(body)
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `Upstream error ${response.status}: ${text.slice(0, 500)}` };
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          return { ok: true, data: { model, response: text } };
        }
        const usage = extractOpenAIUsage(parsedJson);
        await recordSpend(this.ctx.env, {
          provider: "openai-compatible",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: estimateCostUsd(model, usage.promptTokens, usage.completionTokens)
        }).catch(() => {
          /* never fail the chat call on accounting hiccup */
        });
        return { ok: true, data: { model, response: parsedJson } };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
