import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
}

function parseChatInput(input: unknown): ChatInput {
  if (!input || typeof input !== "object") {
    throw new Error("input must be an object with a 'messages' array");
  }
  const candidate = input as Record<string, unknown>;
  const messages = candidate.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("'messages' must be a non-empty array");
  }
  const normalized: ChatMessage[] = messages.map((raw, idx) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`messages[${idx}] must be an object`);
    }
    const m = raw as Record<string, unknown>;
    if (typeof m.content !== "string" || m.content.length === 0) {
      throw new Error(`messages[${idx}].content must be a non-empty string`);
    }
    const role = m.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
      throw new Error(`messages[${idx}].role must be one of system|user|assistant|tool`);
    }
    return {
      role,
      content: m.content,
      name: typeof m.name === "string" ? m.name : undefined
    };
  });

  return {
    messages: normalized,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    stream: Boolean(candidate.stream),
    maxTokens: typeof candidate.maxTokens === "number" ? candidate.maxTokens : undefined,
    temperature: typeof candidate.temperature === "number" ? candidate.temperature : undefined
  };
}

export class WorkersAiPlugin implements AgentPlugin {
  readonly id = "workers-ai";
  readonly version = "0.1.0";
  readonly description = "Cloudflare Workers AI + AI Gateway model plugin";
  readonly capabilities = ["models", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.env.AI) {
      throw new Error("workers-ai requires env.AI binding (add `[ai]` in wrangler.toml)");
    }
    this.ctx = context;
  }

  async invoke(action: string, input: unknown): Promise<PluginResult> {
    if (!this.ctx?.env.AI) {
      return { ok: false, error: "Plugin not initialized" };
    }

    if (action === "status") {
      return {
        ok: true,
        data: {
          provider: "workers-ai",
          modelDefault: this.ctx.config.modelDefault,
          gatewayId: this.ctx.env.AI_GATEWAY_ID ?? null
        }
      };
    }

    if (action === "chat") {
      try {
        const parsed = parseChatInput(input);
        const model = parsed.model ?? this.ctx.config.modelDefault;
        const runInput: Record<string, unknown> = {
          messages: parsed.messages,
          stream: parsed.stream ?? false
        };
        if (parsed.maxTokens !== undefined) {
          runInput.max_tokens = parsed.maxTokens;
        }
        if (parsed.temperature !== undefined) {
          runInput.temperature = parsed.temperature;
        }

        const options: Record<string, unknown> = {};
        if (this.ctx.env.AI_GATEWAY_ID) {
          options.gateway = { id: this.ctx.env.AI_GATEWAY_ID };
        }

        const response = await (this.ctx.env.AI as unknown as {
          run(model: string, input: unknown, opts?: unknown): Promise<unknown>;
        }).run(model, runInput, options);

        return { ok: true, data: { model, response } };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    return { ok: false, error: `Unknown action: ${action}` };
  }
}
