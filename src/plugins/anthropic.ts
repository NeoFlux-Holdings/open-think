import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { enforceSpendingCap, recordSpend } from "../costTracking";
import { estimateCostUsd, extractAnthropicUsage } from "../costPricing";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface RichMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface ChatInput {
  model: string;
  messages: RichMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: AnthropicTool[];
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";

function parseContent(raw: unknown, idx: number): string | ContentBlock[] {
  if (typeof raw === "string") {
    if (raw.length === 0) {
      throw new AppError("E_BAD_REQUEST", `messages[${idx}].content must be a non-empty string`, 400);
    }
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.map((block, bi) => {
      if (!block || typeof block !== "object") {
        throw new AppError("E_BAD_REQUEST", `messages[${idx}].content[${bi}] must be an object`, 400);
      }
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        return { type: "text", text: b.text };
      }
      if (
        b.type === "tool_use" &&
        typeof b.id === "string" &&
        typeof b.name === "string"
      ) {
        return { type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} };
      }
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        return {
          type: "tool_result",
          tool_use_id: b.tool_use_id,
          content: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
          is_error: Boolean(b.is_error)
        };
      }
      throw new AppError(
        "E_BAD_REQUEST",
        `messages[${idx}].content[${bi}] has unsupported block type`,
        400
      );
    });
  }
  throw new AppError("E_BAD_REQUEST", `messages[${idx}].content must be a string or array`, 400);
}

function parseChat(input: unknown): ChatInput {
  if (!input || typeof input !== "object") {
    throw new AppError("E_BAD_REQUEST", "input must be an object", 400);
  }
  const c = input as Record<string, unknown>;
  const model = typeof c.model === "string" ? c.model : "claude-opus-4-7";
  const messages = c.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError("E_BAD_REQUEST", "'messages' must be a non-empty array", 400);
  }
  const normalized: RichMessage[] = messages.map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      throw new AppError("E_BAD_REQUEST", `messages[${idx}] must be an object`, 400);
    }
    const m = raw as Record<string, unknown>;
    const role = m.role;
    if (role !== "user" && role !== "assistant") {
      throw new AppError(
        "E_BAD_REQUEST",
        `messages[${idx}].role must be 'user' or 'assistant' (use 'system' input field for system prompts)`,
        400
      );
    }
    return { role, content: parseContent(m.content, idx) };
  });

  const toolsRaw = c.tools;
  const tools = Array.isArray(toolsRaw)
    ? (toolsRaw as AnthropicTool[]).filter(
        (t) => t && typeof t.name === "string" && typeof t.input_schema === "object"
      )
    : undefined;

  const toolChoiceRaw = c.toolChoice ?? c.tool_choice;
  let toolChoice: ChatInput["toolChoice"] | undefined;
  if (typeof toolChoiceRaw === "string") {
    toolChoice = toolChoiceRaw === "any" ? "any" : "auto";
  } else if (
    toolChoiceRaw &&
    typeof toolChoiceRaw === "object" &&
    (toolChoiceRaw as { type?: string }).type === "tool"
  ) {
    toolChoice = toolChoiceRaw as { type: "tool"; name: string };
  }

  return {
    model,
    messages: normalized,
    system: typeof c.system === "string" ? c.system : undefined,
    maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : 1024,
    temperature: typeof c.temperature === "number" ? c.temperature : undefined,
    tools,
    toolChoice
  };
}

export class AnthropicPlugin implements AgentPlugin {
  readonly id = "anthropic";
  readonly version = "0.2.0";
  readonly description = "Anthropic Claude API provider with tool-use support";
  readonly capabilities = ["models", "connectors"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.env.ANTHROPIC_API_KEY) {
      throw new Error("anthropic plugin requires ANTHROPIC_API_KEY");
    }
    this.ctx = context;
  }

  private baseUrl(): string {
    return (this.ctx?.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
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
            provider: "anthropic",
            baseUrl: this.baseUrl(),
            hasKey: Boolean(this.ctx.env.ANTHROPIC_API_KEY)
          }
        };
      }

      if (action === "chat") {
        const parsed = parseChat(input);

        // Pre-call: refuse if we've hit today's USD spending cap.
        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }

        const body: Record<string, unknown> = {
          model: parsed.model,
          messages: parsed.messages,
          max_tokens: parsed.maxTokens
        };
        if (parsed.system) body.system = parsed.system;
        if (parsed.temperature !== undefined) body.temperature = parsed.temperature;
        if (parsed.tools && parsed.tools.length > 0) {
          body.tools = parsed.tools;
          body.tool_choice = parsed.toolChoice ?? "auto";
        }

        const response = await this.ctx.fetch(`${this.baseUrl()}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.ctx.env.ANTHROPIC_API_KEY ?? "",
            "anthropic-version": DEFAULT_VERSION,
            accept: "application/json"
          },
          body: JSON.stringify(body)
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, error: `Anthropic API error ${response.status}: ${text.slice(0, 500)}` };
        }

        // Post-call: parse, count tokens, accumulate spend in cost_daily.
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          return { ok: true, data: { raw: text } };
        }
        const usage = extractAnthropicUsage(parsedJson);
        await recordSpend(this.ctx.env, {
          provider: "anthropic",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: estimateCostUsd(parsed.model, usage.promptTokens, usage.completionTokens)
        }).catch(() => {
          /* DB unbound or transient — never fail the user-visible call on accounting failure. */
        });
        return { ok: true, data: parsedJson };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
