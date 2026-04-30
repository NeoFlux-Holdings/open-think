import type { AgentRuntime } from "./core/runtime";
import type { SkillManager, SkillDefinition } from "./core/skills";
import type { Env, SessionMessage } from "./types";
import { AppError } from "./core/errors";

export const CONDUCTOR_SESSION_DEFAULT = "conductor:default";
export const MAX_ITERATIONS_DEFAULT = 6;
export const MAX_ITERATIONS_CEILING = 12;

const SYSTEM_PREAMBLE = `You are Helm — a meta-agent that helps the user set up and operate their Open Think runtime on Cloudflare.

Guiding principles:
- Prefer calling a skill tool over free-form prose when the user asks for an action.
- Keep prose compact. Lead with the decision, then one short paragraph of rationale.
- Never invent skill ids. Only call skills that are registered as tools.
- When you have enough information to answer the user, stop calling tools and reply in prose.

If tool calling is unavailable for your provider, fall back to proposing actions as fenced JSON blocks:
\`\`\`open-think-action
{"skill": "skill-id", "input": {}}
\`\`\`

Security: never include secrets verbatim. When describing bindings, use their labels only.
`;

/**
 * Two modes ship in /app's chat:
 *   - "plan"    — Helm describes its approach in markdown. No skill calls.
 *                 Useful for "what would you do?" without side effects.
 *   - "execute" — full tool-use loop end-to-end. Helm calls skills, sees
 *                 results, iterates, summarizes. The default.
 *
 * Legacy modes (propose/selective/auto) are accepted as aliases for
 * back-compat with the older API surface:
 *     "propose"             → plan
 *     "selective" | "auto"  → execute
 *
 * The `normalizeMode()` helper applies the alias collapse on entry.
 */
export type ConductorMode = "plan" | "execute" | "propose" | "selective" | "auto";

export function normalizeMode(m: string | undefined | null): "plan" | "execute" {
  if (m === "plan" || m === "propose") return "plan";
  // Default = execute. selective / auto / undefined all resolve here.
  return "execute";
}

export type ConductorProvider =
  | "workers-ai"
  | "anthropic"
  | "openrouter"
  | "openai-compatible"
  | "cf-ai-gateway"
  | "codex";

export interface ConductorInput {
  sessionName?: string;
  content: string;
  provider?: ConductorProvider;
  model?: string;
  mode?: ConductorMode;
  maxIterations?: number;
  /**
   * Ordered list of fallback models (e.g. ["anthropic/claude-opus-4-6", "openai/gpt-5", "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"]).
   * When set, Helm routes its outgoing call through cf-ai-gateway:chat-with-fallbacks instead of the
   * primary provider. Primary `provider` is ignored. Tool-use is disabled for fallback calls (most useful for
   * pure text responses; run a non-fallback auto-mode turn to follow up with tools).
   */
  fallbackModels?: string[];
  perModelTimeoutMs?: number;
}

export interface SuggestedAction {
  skill: string;
  input?: unknown;
  /** Present when the model tool-called but selective mode held it back. */
  toolUseId?: string;
  reason?: string;
}

export interface TraceStep {
  toolUseId: string;
  skill: string;
  input: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ConductorReply {
  sessionName: string;
  mode: ConductorMode;
  assistantMessage: SessionMessage | null;
  suggestedActions: SuggestedAction[];
  trace: TraceStep[];
  iterationsUsed: number;
  providerUsed: string;
  halted?: "iteration-cap" | "dangerous-skill";
  raw: unknown;
}

/* ---------------- prompt / parsing ---------------- */

export function buildSystemPrompt(skills: SkillDefinition[], mode: ConductorMode): string {
  const head =
    SYSTEM_PREAMBLE +
    (mode === "propose"
      ? "\nMode: PROPOSE. Do not call tools even if available; describe the plan and emit open-think-action JSON blocks so the user can approve each step."
      : mode === "selective"
        ? "\nMode: SELECTIVE. Call safe tools directly. For skills marked dangerous, propose them via open-think-action blocks instead of calling; the user will approve."
        : "\nMode: AUTO. Call tools to accomplish the task end-to-end. Stop tool-calling once you have the answer.");
  if (skills.length === 0) {
    return `${head}\nNo skills are currently enabled. Guide the user through enabling one.`;
  }
  const lines = skills.map(
    (s) => `- ${s.id}${s.dangerous ? " [dangerous]" : ""} — ${s.description} (plugin: ${s.pluginId}, tags: ${s.tags.join("/")})`
  );
  return `${head}\nSkill catalog:\n${lines.join("\n")}`;
}

const ACTION_BLOCK_RE = /```open-think-action\s+([\s\S]*?)```/g;

export function parseActionBlocks(content: string): SuggestedAction[] {
  const matches: SuggestedAction[] = [];
  let m: RegExpExecArray | null;
  ACTION_BLOCK_RE.lastIndex = 0;
  while ((m = ACTION_BLOCK_RE.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as { skill?: unknown; input?: unknown };
      if (typeof parsed.skill === "string" && parsed.skill.length > 0) {
        matches.push({ skill: parsed.skill, input: parsed.input });
      }
    } catch {
      // ignore malformed
    }
  }
  return matches;
}

export function stripActionBlocks(content: string): string {
  return content.replace(/```open-think-action\s+[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------------- tool descriptor builders ---------------- */

export function buildAnthropicTools(skills: SkillDefinition[]) {
  return skills.map((s) => ({
    name: s.id,
    description: s.description,
    input_schema: s.inputSchema ?? { type: "object", additionalProperties: true }
  }));
}

export function buildOpenAITools(skills: SkillDefinition[]) {
  return skills.map((s) => ({
    type: "function" as const,
    function: {
      name: s.id,
      description: s.description,
      parameters: s.inputSchema ?? { type: "object", additionalProperties: true }
    }
  }));
}

/* ---------------- provider text extraction ---------------- */

export function extractAssistantText(provider: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : "";
  }
  const obj = payload as Record<string, unknown>;

  if (provider === "workers-ai") {
    const response = obj.response as unknown;
    if (typeof response === "string") return response;
    if (response && typeof response === "object") {
      const inner = (response as Record<string, unknown>).response;
      if (typeof inner === "string") return inner;
      const answer = (response as Record<string, unknown>).answer;
      if (typeof answer === "string") return answer;
    }
  }

  if (provider === "anthropic") {
    const content = obj.content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (block && typeof block === "object") {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") return b.text;
          }
          return "";
        })
        .join("");
    }
  }

  if (provider === "openai-compatible") {
    const response = obj.response as Record<string, unknown> | undefined;
    const choices = (response?.choices ?? obj.choices) as unknown;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as Record<string, unknown>;
      const message = first.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === "string") return message.content;
      if (typeof first.text === "string") return first.text;
    }
  }

  return "";
}

/* ---------------- provider-specific tool-call extraction ---------------- */

interface ExtractedToolCall {
  id: string;
  name: string;
  input: unknown;
}

function extractAnthropicToolCalls(payload: unknown): ExtractedToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const content = (payload as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const calls: ExtractedToolCall[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        calls.push({ id: b.id, name: b.name, input: b.input ?? {} });
      }
    }
  }
  return calls;
}

function extractOpenAIToolCalls(payload: unknown): ExtractedToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const response = (payload as Record<string, unknown>).response as Record<string, unknown> | undefined;
  const choices = (response?.choices ?? (payload as Record<string, unknown>).choices) as unknown;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const first = choices[0] as Record<string, unknown>;
  const message = first.message as Record<string, unknown> | undefined;
  const tcs = message?.tool_calls;
  if (!Array.isArray(tcs)) return [];
  const calls: ExtractedToolCall[] = [];
  for (const tc of tcs) {
    if (tc && typeof tc === "object") {
      const t = tc as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (typeof t.id === "string" && fn && typeof fn.name === "string") {
        let parsedInput: unknown = {};
        if (typeof fn.arguments === "string") {
          try { parsedInput = JSON.parse(fn.arguments); } catch { parsedInput = fn.arguments; }
        } else if (typeof fn.arguments === "object" && fn.arguments) {
          parsedInput = fn.arguments;
        }
        calls.push({ id: t.id, name: fn.name as string, input: parsedInput });
      }
    }
  }
  return calls;
}

/* ---------------- session helpers ---------------- */

interface SessionStub {
  fetch(req: Request): Promise<Response>;
}

async function sessionInit(stub: SessionStub, title: string): Promise<void> {
  await stub.fetch(
    new Request("https://do/init", { method: "POST", body: JSON.stringify({ title }) })
  );
}

async function sessionMessages(stub: SessionStub): Promise<SessionMessage[]> {
  const response = await stub.fetch(new Request("https://do/messages"));
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { data?: SessionMessage[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

async function sessionAppend(
  stub: SessionStub,
  input: { role: SessionMessage["role"]; content: string; name?: string; toolCallId?: string }
): Promise<SessionMessage | null> {
  const response = await stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      body: JSON.stringify(input)
    })
  );
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { data?: { message: SessionMessage } };
    return json.data?.message ?? null;
  } catch {
    return null;
  }
}

/* ---------------- provider selection ---------------- */

function pickProvider(
  requested: ConductorInput["provider"],
  enabledPluginIds: Set<string>,
  env?: { OPENROUTER_API_KEY?: string; ANTHROPIC_API_KEY?: string; AI_GATEWAY_ID?: string; OPENAI_COMPATIBLE_URL?: string }
): ConductorProvider {
  if (requested && enabledPluginIds.has(requested)) return requested;
  // OpenRouter on top — when configured, it's the most capable default
  // (auto-routes to the best model for the prompt). One paste, every model.
  if (enabledPluginIds.has("openrouter") && env?.OPENROUTER_API_KEY) return "openrouter";
  if (enabledPluginIds.has("anthropic") && env?.ANTHROPIC_API_KEY) return "anthropic";
  if (enabledPluginIds.has("cf-ai-gateway") && env?.AI_GATEWAY_ID) return "cf-ai-gateway";
  if (enabledPluginIds.has("openai-compatible") && env?.OPENAI_COMPATIBLE_URL) return "openai-compatible";
  if (enabledPluginIds.has("workers-ai")) return "workers-ai";
  if (enabledPluginIds.has("codex")) return "codex";
  // Last-resort: any enabled provider, even if env config is missing.
  // The downstream call will surface the missing-key error with a clear message.
  if (enabledPluginIds.has("openrouter")) return "openrouter";
  if (enabledPluginIds.has("anthropic")) return "anthropic";
  if (enabledPluginIds.has("cf-ai-gateway")) return "cf-ai-gateway";
  if (enabledPluginIds.has("workers-ai")) return "workers-ai";
  if (enabledPluginIds.has("openai-compatible")) return "openai-compatible";
  if (enabledPluginIds.has("codex")) return "codex";
  throw new AppError(
    "E_NO_PROVIDER",
    "No chat provider enabled. Add openrouter (OPENROUTER_API_KEY), anthropic (ANTHROPIC_API_KEY), cf-ai-gateway (AI_GATEWAY_ID), workers-ai (auto), openai-compatible, or codex.",
    400
  );
}

function supportsNativeTools(provider: string): boolean {
  return (
    provider === "anthropic" ||
    provider === "openrouter" ||
    provider === "openai-compatible" ||
    provider === "cf-ai-gateway" ||
    provider === "codex"
  );
}

/* ---------------- main handler ---------------- */

export async function handleConductorMessage(
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager,
  body: ConductorInput
): Promise<ConductorReply> {
  if (!body?.content || typeof body.content !== "string") {
    throw new AppError("E_BAD_REQUEST", "content is required", 400);
  }
  if (!env.AGENT_SESSIONS) {
    throw new AppError("E_DO_BINDING_MISSING", "AGENT_SESSIONS Durable Object binding required", 500);
  }

  const sessionName = body.sessionName ?? CONDUCTOR_SESSION_DEFAULT;
  const doId = env.AGENT_SESSIONS.idFromName(sessionName);
  const stub = env.AGENT_SESSIONS.get(doId);

  const enabledPluginIds = new Set(runtime.listPlugins().map((p) => p.id));
  const provider = pickProvider(body.provider, enabledPluginIds, env);

  // The wire still accepts legacy modes (propose/selective/auto) AND the
  // new ones (plan/execute). Collapse to the two canonical values, then
  // map back to the internal "propose" path for plan and the "auto" path
  // for execute. Providers without native tool-use are forced to plan
  // ("propose") since they can't run a tool loop end-to-end.
  const normalized = normalizeMode(body.mode);
  const mode: ConductorMode =
    normalized === "execute" && supportsNativeTools(provider)
      ? "auto"
      : "propose";

  const maxIter = Math.min(
    Math.max(1, body.maxIterations ?? MAX_ITERATIONS_DEFAULT),
    MAX_ITERATIONS_CEILING
  );

  await sessionInit(stub, "Helm session");
  const history = await sessionMessages(stub);
  const skillList = skills.listSkills();
  const skillById = new Map(skillList.map((s) => [s.id, s]));
  const systemPrompt = buildSystemPrompt(skillList, mode);

  await sessionAppend(stub, { role: "user", content: body.content });

  if (Array.isArray(body.fallbackModels) && body.fallbackModels.length > 0) {
    return await runFallbackChain({
      runtime,
      stub,
      history,
      userMessage: body.content,
      systemPrompt,
      sessionName,
      models: body.fallbackModels,
      perModelTimeoutMs: body.perModelTimeoutMs,
      mode
    });
  }

  if (mode === "propose" || !supportsNativeTools(provider)) {
    return await runProposeMode({
      provider,
      runtime,
      stub,
      history,
      userMessage: body.content,
      systemPrompt,
      sessionName,
      model: body.model
    });
  }

  if (provider === "anthropic") {
    return await runAnthropicLoop({
      runtime,
      stub,
      history,
      userMessage: body.content,
      systemPrompt,
      sessionName,
      model: body.model,
      skillList,
      skillById,
      mode,
      maxIter
    });
  }

  if (provider === "workers-ai") {
    return await runProposeMode({
      provider,
      runtime,
      stub,
      history,
      userMessage: body.content,
      systemPrompt,
      sessionName,
      model: body.model
    });
  }

  return await runOpenAILoop({
    provider,
    runtime,
    stub,
    history,
    userMessage: body.content,
    systemPrompt,
    sessionName,
    model: body.model,
    skillList,
    skillById,
    mode,
    maxIter
  });
}

/* ---------------- fallback chain (cf-ai-gateway) ---------------- */

interface FallbackArgs {
  runtime: AgentRuntime;
  stub: SessionStub;
  history: SessionMessage[];
  userMessage: string;
  systemPrompt: string;
  sessionName: string;
  models: string[];
  perModelTimeoutMs?: number;
  mode: ConductorMode;
}

async function runFallbackChain(args: FallbackArgs): Promise<ConductorReply> {
  const messages = [
    { role: "system" as const, content: args.systemPrompt },
    ...args.history
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: args.userMessage }
  ];

  const result = await args.runtime.invoke("cf-ai-gateway", {
    action: "chat-with-fallbacks",
    input: {
      models: args.models,
      messages,
      perModelTimeoutMs: args.perModelTimeoutMs
    }
  });

  if (!result.ok) {
    await sessionAppend(args.stub, {
      role: "system",
      content: `[conductor-error] fallback chain exhausted: ${result.error ?? "all models failed"}`
    });
    throw new AppError(
      "E_FALLBACKS_EXHAUSTED",
      result.error ?? "fallback chain exhausted",
      502
    );
  }

  const data = result.data as {
    winner?: { model: string; index: number };
    attempts?: unknown[];
    response?: unknown;
  };

  const assistantText = extractAssistantText("openai-compatible", {
    response: data.response
  }).trim();
  const display = assistantText || "(no prose reply)";

  const assistantMessage = await sessionAppend(args.stub, {
    role: "assistant",
    content: display,
    name: `cf-ai-gateway:${data.winner?.model ?? "fallback"}`
  });

  return {
    sessionName: args.sessionName,
    mode: args.mode,
    assistantMessage,
    suggestedActions: [],
    trace: [],
    iterationsUsed: 1,
    providerUsed: `cf-ai-gateway/${data.winner?.model ?? "unknown"}`,
    raw: data
  };
}

/* ---------------- propose mode (no tool-use) ---------------- */

interface ProposeArgs {
  provider: ConductorProvider;
  runtime: AgentRuntime;
  stub: SessionStub;
  history: SessionMessage[];
  userMessage: string;
  systemPrompt: string;
  sessionName: string;
  model?: string;
}

async function runProposeMode(args: ProposeArgs): Promise<ConductorReply> {
  const providerInput = buildSimpleProviderInput(
    args.provider,
    args.systemPrompt,
    args.history,
    args.userMessage,
    args.model
  );
  const result = await args.runtime.invoke(args.provider, { action: "chat", input: providerInput });

  if (!result.ok) {
    await sessionAppend(args.stub, {
      role: "system",
      content: `[conductor-error] ${result.error ?? "provider call failed"}`
    });
    throw new AppError("E_PROVIDER_FAILED", result.error ?? "provider call failed", 502);
  }

  const rawText = extractAssistantText(args.provider, result.data).trim();
  const suggested = parseActionBlocks(rawText);
  const display = stripActionBlocks(rawText) || "(no prose reply; see proposed actions)";
  const assistantMessage = rawText
    ? await sessionAppend(args.stub, { role: "assistant", content: display, name: args.provider })
    : null;

  return {
    sessionName: args.sessionName,
    mode: "propose",
    assistantMessage,
    suggestedActions: suggested,
    trace: [],
    iterationsUsed: 1,
    providerUsed: args.provider,
    raw: result.data
  };
}

function buildSimpleProviderInput(
  provider: ConductorProvider,
  systemPrompt: string,
  history: SessionMessage[],
  userMessage: string,
  model?: string
): unknown {
  if (provider === "anthropic") {
    const pairs = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      model: model ?? "claude-haiku-4-5-20251001",
      system: systemPrompt,
      messages: [...pairs, { role: "user", content: userMessage }],
      maxTokens: 1024
    };
  }
  const msgs = [
    { role: "system" as const, content: systemPrompt },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage }
  ];
  return model ? { messages: msgs, model } : { messages: msgs };
}

/* ---------------- Anthropic auto loop ---------------- */

interface LoopArgs {
  runtime: AgentRuntime;
  stub: SessionStub;
  history: SessionMessage[];
  userMessage: string;
  systemPrompt: string;
  sessionName: string;
  model?: string;
  skillList: SkillDefinition[];
  skillById: Map<string, SkillDefinition>;
  mode: ConductorMode;
  maxIter: number;
}

async function runAnthropicLoop(args: LoopArgs): Promise<ConductorReply> {
  type AnthroMsg = { role: "user" | "assistant"; content: unknown };
  const messages: AnthroMsg[] = [];
  for (const m of args.history) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: args.userMessage });

  const tools = buildAnthropicTools(args.skillList);
  const trace: TraceStep[] = [];
  const pending: SuggestedAction[] = [];
  let iterations = 0;
  let lastRaw: unknown = null;
  let finalText = "";
  let halted: ConductorReply["halted"] | undefined;

  while (iterations < args.maxIter) {
    iterations += 1;
    const result = await args.runtime.invoke("anthropic", {
      action: "chat",
      input: {
        model: args.model ?? "claude-haiku-4-5-20251001",
        system: args.systemPrompt,
        messages,
        tools,
        toolChoice: "auto",
        maxTokens: 1024
      }
    });
    lastRaw = result.data;
    if (!result.ok) {
      await sessionAppend(args.stub, {
        role: "system",
        content: `[conductor-error] ${result.error ?? "provider call failed"}`
      });
      throw new AppError("E_PROVIDER_FAILED", result.error ?? "provider call failed", 502);
    }

    const assistantContent = (result.data as { content?: unknown }).content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolCalls = extractAnthropicToolCalls(result.data);
    const textPart = extractAssistantText("anthropic", result.data).trim();
    if (textPart) finalText = textPart;

    if (toolCalls.length === 0) break;

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    let haltedThisTurn = false;

    for (const call of toolCalls) {
      const skill = args.skillById.get(call.name);
      if (!skill) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Skill '${call.name}' is not available`,
          is_error: true
        });
        continue;
      }
      if (args.mode === "selective" && skill.dangerous) {
        pending.push({
          skill: skill.id,
          input: call.input,
          toolUseId: call.id,
          reason: "dangerous skill held for approval"
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            "SELECTIVE_HOLD: this skill is marked dangerous. The user must approve it. Do not retry this tool; continue or conclude.",
          is_error: false
        });
        haltedThisTurn = true;
        continue;
      }
      const step = await executeSkillStep(args.runtime, args.stub, skill, call);
      trace.push(step);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: step.ok ? safeStringify(step.result) : safeStringify({ error: step.error }),
        is_error: !step.ok
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (haltedThisTurn && args.mode === "selective") {
      halted = "dangerous-skill";
      break;
    }
  }

  if (iterations >= args.maxIter && !halted) halted = "iteration-cap";

  const display = finalText || (pending.length > 0 ? "Held for approval — review the exhibit below." : "(no reply)");
  const assistantMessage = await sessionAppend(args.stub, {
    role: "assistant",
    content: display,
    name: "anthropic"
  });

  return {
    sessionName: args.sessionName,
    mode: args.mode,
    assistantMessage,
    suggestedActions: pending,
    trace,
    iterationsUsed: iterations,
    providerUsed: "anthropic",
    halted,
    raw: lastRaw
  };
}

/* ---------------- OpenAI-compatible auto loop (also cf-ai-gateway + codex) ---------------- */

interface OpenAILoopArgs extends LoopArgs {
  provider: "openai-compatible" | "cf-ai-gateway" | "codex" | "openrouter";
}

async function runOpenAILoop(args: OpenAILoopArgs): Promise<ConductorReply> {
  type OAIMsg = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  };

  const messages: OAIMsg[] = [{ role: "system", content: args.systemPrompt }];
  for (const m of args.history) {
    if (m.role === "user" || m.role === "assistant" || m.role === "system") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: args.userMessage });

  const tools = buildOpenAITools(args.skillList);
  const trace: TraceStep[] = [];
  const pending: SuggestedAction[] = [];
  let iterations = 0;
  let lastRaw: unknown = null;
  let finalText = "";
  let halted: ConductorReply["halted"] | undefined;

  while (iterations < args.maxIter) {
    iterations += 1;
    const result = await args.runtime.invoke(args.provider, {
      action: "chat",
      input: {
        messages,
        model: args.model,
        tools,
        toolChoice: "auto"
      }
    });
    lastRaw = result.data;
    if (!result.ok) {
      await sessionAppend(args.stub, {
        role: "system",
        content: `[conductor-error] ${result.error ?? "provider call failed"}`
      });
      throw new AppError("E_PROVIDER_FAILED", result.error ?? "provider call failed", 502);
    }

    const response = (result.data as { response?: Record<string, unknown> }).response;
    const choices = response?.choices as unknown;
    const firstChoice =
      Array.isArray(choices) && choices.length > 0 ? (choices[0] as Record<string, unknown>) : null;
    const assistantMsg = (firstChoice?.message ?? {}) as Record<string, unknown>;
    const textPart = typeof assistantMsg.content === "string" ? assistantMsg.content : "";
    if (textPart) finalText = textPart;

    const toolCalls = extractOpenAIToolCalls(result.data);

    messages.push({
      role: "assistant",
      content: textPart || null,
      tool_calls:
        toolCalls.length > 0
          ? toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: safeStringify(tc.input) }
            }))
          : undefined
    });

    if (toolCalls.length === 0) break;

    let haltedThisTurn = false;
    for (const call of toolCalls) {
      const skill = args.skillById.get(call.name);
      if (!skill) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Skill '${call.name}' is not available`
        });
        continue;
      }
      if (args.mode === "selective" && skill.dangerous) {
        pending.push({
          skill: skill.id,
          input: call.input,
          toolUseId: call.id,
          reason: "dangerous skill held for approval"
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "SELECTIVE_HOLD: this skill is marked dangerous. The user must approve it. Do not retry this tool; continue or conclude."
        });
        haltedThisTurn = true;
        continue;
      }
      const step = await executeSkillStep(args.runtime, args.stub, skill, call);
      trace.push(step);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: step.ok ? safeStringify(step.result) : safeStringify({ error: step.error })
      });
    }

    if (haltedThisTurn && args.mode === "selective") {
      halted = "dangerous-skill";
      break;
    }
  }

  if (iterations >= args.maxIter && !halted) halted = "iteration-cap";

  const display = finalText || (pending.length > 0 ? "Held for approval — review the exhibit below." : "(no reply)");
  const assistantMessage = await sessionAppend(args.stub, {
    role: "assistant",
    content: display,
    name: args.provider
  });

  return {
    sessionName: args.sessionName,
    mode: args.mode,
    assistantMessage,
    suggestedActions: pending,
    trace,
    iterationsUsed: iterations,
    providerUsed: args.provider,
    halted,
    raw: lastRaw
  };
}

/* ---------------- tool execution ---------------- */

async function executeSkillStep(
  runtime: AgentRuntime,
  stub: SessionStub,
  skill: SkillDefinition,
  call: ExtractedToolCall
): Promise<TraceStep> {
  const started = Date.now();
  try {
    const result = await runtime.invoke(skill.pluginId, { action: skill.action, input: call.input });
    const durationMs = Date.now() - started;
    await sessionAppend(stub, {
      role: "tool",
      name: skill.id,
      toolCallId: call.id,
      content: safeStringify({ skill: skill.id, input: call.input, result })
    });
    return {
      toolUseId: call.id,
      skill: skill.id,
      input: call.input,
      ok: result.ok,
      result: result.ok ? result.data : undefined,
      error: result.ok ? undefined : result.error,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = (error as Error).message;
    await sessionAppend(stub, {
      role: "tool",
      name: skill.id,
      toolCallId: call.id,
      content: safeStringify({ skill: skill.id, input: call.input, error: message })
    });
    return {
      toolUseId: call.id,
      skill: skill.id,
      input: call.input,
      ok: false,
      error: message,
      durationMs
    };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
