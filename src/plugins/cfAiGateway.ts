import type { AgentPlugin, PluginContext, PluginResult } from "../core/plugin";
import { AppError } from "../core/errors";
import { enforceSpendingCap, recordSpend } from "../costTracking";
import { estimateCostUsd, extractOpenAIUsage } from "../costPricing";

/**
 * Cloudflare AI Gateway plugin — one plugin, 23+ providers.
 *
 * Two paths:
 *   1. Binding path — `env.AI.run('provider/model', input, { gateway: { id } })`.
 *      Requires AI_GATEWAY_ID and the env.AI binding. BYOK keys live in the CF
 *      dashboard (Secrets Store -> AI Gateway -> Provider Keys).
 *   2. Compat path — POST to
 *      `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/chat/completions`
 *      with an OpenAI-shaped request and `model: "provider/model"`. Requires
 *      CLOUDFLARE_ACCOUNT_ID + AI_GATEWAY_ID. Provider key is passed either
 *      directly (`Authorization: Bearer`) or as a Secrets Store reference
 *      (`cf-aig-authorization: KEY_NAME`).
 *
 * Supported providers (subject to Cloudflare's catalog):
 *   workers-ai, anthropic, openai, google-ai-studio, google-vertex-ai,
 *   amazon-bedrock, azure-openai, groq, cerebras, cohere, deepseek, mistral,
 *   openrouter, perplexity, xai, huggingface, cartesia, elevenlabs, fal,
 *   deepgram, replicate, baseten, ideogram, parallel
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

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatInput {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  toolChoice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  /** Optional Secrets Store key reference, e.g. "ANTHROPIC_KEY_1". */
  providerKeyRef?: string;
  /** Explicit runtime provider API key (for ad-hoc BYOK). */
  providerApiKey?: string;
  /** Force the compat REST path instead of env.AI.run(). */
  forceCompat?: boolean;
}

interface FallbackChatInput extends Omit<ChatInput, "model"> {
  models: string[];
  perModelTimeoutMs?: number;
}

interface FallbackAttempt {
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
}

const KNOWN_PROVIDERS = [
  "workers-ai",
  "anthropic",
  "openai",
  "google-ai-studio",
  "google-vertex-ai",
  "amazon-bedrock",
  "azure-openai",
  "groq",
  "cerebras",
  "cohere",
  "deepseek",
  "mistral",
  "openrouter",
  "perplexity",
  "xai",
  "huggingface",
  "cartesia",
  "elevenlabs",
  "fal",
  "deepgram",
  "replicate",
  "baseten",
  "ideogram",
  "parallel"
] as const;

type ProviderSlug = (typeof KNOWN_PROVIDERS)[number];

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
  if (role !== "assistant" && role !== "tool" && typeof m.content !== "string") {
    throw new AppError("E_BAD_REQUEST", `messages[${idx}].content must be a string`, 400);
  }
  return msg;
}

function parseCommon(c: Record<string, unknown>): Omit<ChatInput, "model" | "messages"> {
  const tools = Array.isArray(c.tools)
    ? (c.tools as OpenAITool[]).filter(
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
    maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : undefined,
    temperature: typeof c.temperature === "number" ? c.temperature : undefined,
    stream: Boolean(c.stream),
    tools,
    toolChoice,
    providerKeyRef: typeof c.providerKeyRef === "string" ? c.providerKeyRef : undefined,
    providerApiKey: typeof c.providerApiKey === "string" ? c.providerApiKey : undefined,
    forceCompat: Boolean(c.forceCompat)
  };
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
  return {
    messages: messages.map((m, idx) => parseMessage(m, idx)),
    model: typeof c.model === "string" ? c.model : undefined,
    ...parseCommon(c)
  };
}

function parseFallbackChat(input: unknown): FallbackChatInput {
  if (!input || typeof input !== "object") {
    throw new AppError("E_BAD_REQUEST", "input must be an object with 'messages' and 'models'", 400);
  }
  const c = input as Record<string, unknown>;
  const messages = c.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError("E_BAD_REQUEST", "'messages' must be a non-empty array", 400);
  }
  const models = c.models;
  if (!Array.isArray(models) || models.length === 0) {
    throw new AppError(
      "E_BAD_REQUEST",
      "'models' must be a non-empty array of 'provider/model-name' strings",
      400
    );
  }
  for (const m of models) {
    if (typeof m !== "string" || !m.includes("/")) {
      throw new AppError(
        "E_BAD_REQUEST",
        `each models[] entry must be a 'provider/model-name' string (got ${JSON.stringify(m)})`,
        400
      );
    }
  }
  const timeout = c.perModelTimeoutMs;
  return {
    messages: messages.map((m, idx) => parseMessage(m, idx)),
    models: models as string[],
    perModelTimeoutMs: typeof timeout === "number" && timeout > 0 ? timeout : undefined,
    ...parseCommon(c)
  };
}

function splitProvider(model: string): { provider: ProviderSlug; modelName: string } | null {
  const idx = model.indexOf("/");
  if (idx <= 0) return null;
  const provider = model.slice(0, idx);
  const modelName = model.slice(idx + 1);
  if (!KNOWN_PROVIDERS.includes(provider as ProviderSlug)) {
    return null;
  }
  return { provider: provider as ProviderSlug, modelName };
}

export class CfAiGatewayPlugin implements AgentPlugin {
  readonly id = "cf-ai-gateway";
  readonly version = "0.1.0";
  readonly description =
    "Cloudflare AI Gateway — universal provider access (23+ providers) with BYOK via Secrets Store";
  readonly capabilities = ["models", "connectors", "tools"] as const;

  private ctx?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    const hasGateway = Boolean(context.env.AI_GATEWAY_ID);
    const hasAccount = Boolean(context.env.CLOUDFLARE_ACCOUNT_ID);
    const hasBinding = Boolean(context.env.AI);
    if (!hasGateway) {
      throw new Error(
        "cf-ai-gateway requires AI_GATEWAY_ID. Create a gateway at https://dash.cloudflare.com/?to=/:account/ai/ai-gateway"
      );
    }
    if (!hasBinding && !hasAccount) {
      throw new Error(
        "cf-ai-gateway requires either env.AI binding (preferred) or CLOUDFLARE_ACCOUNT_ID for the compat REST path"
      );
    }
    this.ctx = context;
  }

  private gatewayId(): string {
    return this.ctx!.env.AI_GATEWAY_ID!;
  }

  private compatUrl(): string {
    const account = this.ctx!.env.CLOUDFLARE_ACCOUNT_ID;
    if (!account) {
      throw new AppError(
        "E_CF_ACCOUNT_MISSING",
        "CLOUDFLARE_ACCOUNT_ID is required for the compat REST path",
        400
      );
    }
    return `https://gateway.ai.cloudflare.com/v1/${account}/${this.gatewayId()}/compat`;
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
            provider: "cf-ai-gateway",
            gatewayId: this.gatewayId(),
            hasBinding: Boolean(this.ctx.env.AI),
            hasAccountId: Boolean(this.ctx.env.CLOUDFLARE_ACCOUNT_ID),
            hasAuthToken: Boolean(this.ctx.env.AI_GATEWAY_AUTH_TOKEN),
            defaultModel: this.ctx.env.CF_AI_GATEWAY_DEFAULT_MODEL ?? this.ctx.config.modelDefault,
            supportedProviders: KNOWN_PROVIDERS
          }
        };
      }

      if (action === "list-providers") {
        return { ok: true, data: { providers: KNOWN_PROVIDERS } };
      }

      if (action === "chat") {
        const parsed = parseChat(input);
        const model =
          parsed.model ?? this.ctx.env.CF_AI_GATEWAY_DEFAULT_MODEL ?? this.ctx.config.modelDefault;
        const split = splitProvider(model);
        if (!split) {
          return {
            ok: false,
            error: `model must be in 'provider/model-name' format (got '${model}'). Known providers: ${KNOWN_PROVIDERS.join(
              ", "
            )}`
          };
        }

        // Pre-call cap check.
        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }

        const result =
          !parsed.forceCompat &&
          this.ctx.env.AI &&
          typeof (this.ctx.env.AI as unknown as { run?: unknown }).run === "function"
            ? await this.invokeViaBinding(model, parsed)
            : await this.invokeViaCompat(model, parsed);

        // Per-call provisional accounting. The daily AI Gateway rollup will
        // overwrite this row at 01:15 UTC the next day with truth-from-CF.
        if (result.ok) {
          const usage = extractOpenAIUsage(result.data);
          await recordSpend(this.ctx.env, {
            provider: "cf-ai-gateway",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd: estimateCostUsd(model, usage.promptTokens, usage.completionTokens)
          }).catch(() => {
            /* DB unbound or transient — never fail the user-visible call on accounting failure. */
          });
        }
        return result;
      }

      if (action === "chat-with-fallbacks") {
        const cap = await enforceSpendingCap(this.ctx.env);
        if (!cap.allowed) {
          return { ok: false, error: cap.reason ?? "daily spending cap reached" };
        }
        const result = await this.invokeWithFallbacks(parseFallbackChat(input));
        if (result.ok) {
          const usage = extractOpenAIUsage(result.data);
          const winner = (result.data as { winner?: { model?: string } } | undefined)?.winner?.model;
          await recordSpend(this.ctx.env, {
            provider: "cf-ai-gateway",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd: estimateCostUsd(winner, usage.promptTokens, usage.completionTokens)
          }).catch(() => {
            /* never fail on accounting */
          });
        }
        return result;
      }

      return { ok: false, error: `Unknown action: ${action}` };
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, error: error.message };
      }
      return { ok: false, error: (error as Error).message };
    }
  }

  private async invokeViaBinding(model: string, parsed: ChatInput): Promise<PluginResult> {
    const aiInput: Record<string, unknown> = {
      messages: parsed.messages,
      stream: parsed.stream ?? false
    };
    if (parsed.maxTokens !== undefined) aiInput.max_tokens = parsed.maxTokens;
    if (parsed.temperature !== undefined) aiInput.temperature = parsed.temperature;
    if (parsed.tools && parsed.tools.length > 0) {
      aiInput.tools = parsed.tools;
      if (parsed.toolChoice) aiInput.tool_choice = parsed.toolChoice;
    }

    const options: Record<string, unknown> = { gateway: { id: this.gatewayId() } };

    try {
      const response = await (this.ctx!.env.AI as unknown as {
        run(model: string, input: unknown, opts?: unknown): Promise<unknown>;
      }).run(model, aiInput, options);
      return { ok: true, data: { model, path: "binding", response } };
    } catch (error) {
      return { ok: false, error: `env.AI.run failed: ${(error as Error).message}` };
    }
  }

  private async invokeViaCompat(model: string, parsed: ChatInput): Promise<PluginResult> {
    const response = await this.rawCompatRequest(model, parsed);
    if (!response.ok) {
      return {
        ok: false,
        error: `AI Gateway error ${response.status}: ${response.bodyText.slice(0, 500)}`
      };
    }
    return {
      ok: true,
      data: { model, path: "compat", response: response.parsed ?? response.bodyText }
    };
  }

  private async invokeWithFallbacks(parsed: FallbackChatInput): Promise<PluginResult> {
    const attempts: FallbackAttempt[] = [];
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    for (let i = 0; i < parsed.models.length; i += 1) {
      const model = parsed.models[i];
      const split = splitProvider(model);
      if (!split) {
        attempts.push({
          model,
          ok: false,
          error: `model '${model}' is not provider/model-name format`,
          durationMs: 0
        });
        continue;
      }

      const started = Date.now();
      let timedOut = false;
      const timeoutPromise = parsed.perModelTimeoutMs
        ? new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              reject(new Error(`timeout after ${parsed.perModelTimeoutMs}ms`));
            }, parsed.perModelTimeoutMs);
          })
        : null;

      try {
        const request = this.rawCompatRequest(model, { ...parsed, model });
        const response = await (timeoutPromise
          ? Promise.race([request, timeoutPromise])
          : request);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const durationMs = Date.now() - started;

        if (response.ok) {
          attempts.push({ model, ok: true, status: response.status, durationMs });
          return {
            ok: true,
            data: {
              path: "compat",
              winner: { model, index: i },
              attempts,
              response: response.parsed ?? response.bodyText
            }
          };
        }
        attempts.push({
          model,
          ok: false,
          status: response.status,
          error: response.bodyText.slice(0, 300),
          durationMs
        });
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const durationMs = Date.now() - started;
        attempts.push({
          model,
          ok: false,
          error: timedOut ? `timeout after ${parsed.perModelTimeoutMs}ms` : (error as Error).message,
          durationMs
        });
      }
    }

    return {
      ok: false,
      error: `All ${parsed.models.length} fallback models failed`,
      data: { attempts }
    } as PluginResult;
  }

  private async rawCompatRequest(
    model: string,
    parsed: ChatInput
  ): Promise<{ ok: boolean; status: number; bodyText: string; parsed: unknown }> {
    const url = `${this.compatUrl()}/chat/completions`;
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

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json"
    };
    if (this.ctx!.env.AI_GATEWAY_AUTH_TOKEN) {
      headers["cf-aig-authorization"] = `Bearer ${this.ctx!.env.AI_GATEWAY_AUTH_TOKEN}`;
    }
    if (parsed.providerKeyRef) {
      headers["cf-aig-authorization"] = parsed.providerKeyRef;
    }
    if (parsed.providerApiKey) {
      headers.Authorization = `Bearer ${parsed.providerApiKey}`;
    }

    const response = await this.ctx!.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const bodyText = await response.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsedBody = null;
    }
    return { ok: response.ok, status: response.status, bodyText, parsed: parsedBody };
  }
}
