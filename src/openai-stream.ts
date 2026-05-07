/**
 * OpenAI-compatible streaming + tool-use loop.
 *
 * Speaks `/v1/chat/completions` with `stream: true`. Works against:
 *   - `openai-compatible` plugin's base URL (Groq, Together, Ollama, vLLM, OpenAI direct)
 *   - `cf-ai-gateway` compat endpoint (any of the 23+ providers via provider/model syntax)
 *
 * Emits the same provider-agnostic {@link LoopEvent} union as anthropic-stream.
 * Callers decide the baseUrl / api key; this module is pure protocol logic.
 */

import { buildOpenAITools } from "./conductor";
import {
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATION_CEILING,
  type LoopEvent,
  type ToolLoopConfig
} from "./tool-stream-types";

export interface OpenAIStreamConfig extends ToolLoopConfig {
  /**
   * Base URL ending *without* `/chat/completions`. E.g.
   * `https://api.groq.com/openai/v1`. Required unless `customInvoke`
   * is provided (the workers-ai-stream wrapper uses customInvoke to
   * bypass HTTP entirely).
   */
  baseUrl?: string;
  /** Optional bearer token; some compat servers (Ollama) are open. */
  apiKey?: string;
  /** Optional label used in tool-result assistant messages for audit clarity. */
  providerLabel?: string;
  /** Optional extra headers (e.g. cf-aig-authorization for CF AI Gateway BYOK). */
  extraHeaders?: Record<string, string>;
  /**
   * Optional custom request invoker. When provided, the per-turn HTTP
   * fetch is replaced with this callback, which receives the OpenAI-
   * format request body and returns the streaming SSE body. Used by
   * `runWorkersAiToolStream` to call `env.AI.run(model, body, {stream:true})`
   * directly — bypasses cf-ai-gateway's `/compat` URL (the source of
   * `code:2019 "Chat completion bad format"` for `@cf/...` models).
   */
  customInvoke?: (body: Record<string, unknown>) => Promise<
    | { ok: true; stream: ReadableStream<Uint8Array> }
    | { ok: false; status?: number; error: string }
  >;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  argsBuffer: string;
  emittedStart: boolean;
}

export async function* runOpenAICompatibleToolStream(
  config: OpenAIStreamConfig
): AsyncGenerator<LoopEvent, void, unknown> {
  if (!config.baseUrl && !config.customInvoke) {
    yield { kind: "error", message: "baseUrl or customInvoke is required", code: "E_OAI_URL_MISSING" };
    return;
  }

  const skillById = new Map(config.skillList.map((s) => [s.id, s]));
  const tools = buildOpenAITools(config.skillList);
  const mode = config.mode ?? "selective";
  const maxIter = Math.min(
    Math.max(1, config.maxIterations ?? DEFAULT_MAX_ITERATIONS),
    MAX_ITERATION_CEILING
  );

  type OAIMsg = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  };

  const messages: OAIMsg[] = [
    { role: "system", content: config.systemPrompt },
    ...config.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: config.userContent }
  ];

  let finalText = "";
  let heldActions = false;
  const url = config.baseUrl ? `${config.baseUrl.replace(/\/$/, "")}/chat/completions` : "";
  const providerLabel = config.providerLabel ?? "OpenAI-compatible";

  for (let turn = 1; turn <= maxIter; turn += 1) {
    if (config.abortSignal?.aborted) {
      yield { kind: "loop-done", reason: "cancelled", finalText };
      return;
    }

    yield { kind: "turn-start", turn };

    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      stream: true,
      tools,
      tool_choice: "auto"
    };
    if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
    // Reasoning effort. Two acceptable shapes for the same parameter:
    //   - GPT-5.5 / OpenRouter expect `reasoning: { effort: "<level>" }`
    //   - Some legacy providers accept `reasoning_effort: "<level>"` as a
    //     top-level string. Sending both is harmless: a provider that
    //     doesn't recognize one ignores it. CF AI Gateway forwards the
    //     body unchanged to the upstream provider.
    // "none" is the user's explicit "don't think" — we drop the field
    // so providers fall through to their non-reasoning fast path.
    if (config.reasoningEffort && config.reasoningEffort !== "none") {
      body.reasoning = { effort: config.reasoningEffort };
      body.reasoning_effort = config.reasoningEffort;
    }

    // Stream source — either a custom invoker (workers-ai native binding)
    // or a plain HTTP POST to an OpenAI-compatible endpoint.
    let streamBody: ReadableStream<Uint8Array>;
    if (config.customInvoke) {
      const invoked = await config.customInvoke(body);
      if (!invoked.ok) {
        yield {
          kind: "error",
          message: `${providerLabel}${invoked.status ? ` ${invoked.status}` : ""}: ${invoked.error.slice(0, 300)}`,
          code: "E_OAI_HTTP"
        };
        return;
      }
      streamBody = invoked.stream;
    } else {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(config.extraHeaders ?? {})
      };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: config.abortSignal
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        yield {
          kind: "error",
          message: `${providerLabel} ${response.status}: ${text.slice(0, 300)}`,
          code: "E_OAI_HTTP"
        };
        return;
      }
      streamBody = response.body;
    }

    let textIndex = -1; // -1 = no text block started yet this turn
    let turnText = "";
    const toolAccs = new Map<number, ToolCallAccumulator>();
    let finishReason: string | null = null;

    for await (const chunk of parseOpenAISse(streamBody)) {
      if (config.abortSignal?.aborted) {
        yield { kind: "loop-done", reason: "cancelled", finalText };
        return;
      }

      const choices = chunk.choices;
      if (!Array.isArray(choices) || choices.length === 0) continue;
      const choice = choices[0] as Record<string, unknown>;
      const delta = (choice.delta as Record<string, unknown>) ?? {};

      // Text content delta
      if (typeof delta.content === "string" && delta.content.length > 0) {
        if (textIndex === -1) {
          textIndex = 0;
          yield { kind: "text-start", index: textIndex };
        }
        turnText += delta.content;
        yield { kind: "text-delta", index: textIndex, text: delta.content };
      }

      // Tool-call deltas
      const toolCallDeltas = delta.tool_calls;
      if (Array.isArray(toolCallDeltas)) {
        for (const tcRaw of toolCallDeltas) {
          if (!tcRaw || typeof tcRaw !== "object") continue;
          const tc = tcRaw as Record<string, unknown>;
          const index = typeof tc.index === "number" ? tc.index : 0;
          let acc = toolAccs.get(index);
          if (!acc) {
            acc = { id: "", name: "", argsBuffer: "", emittedStart: false };
            toolAccs.set(index, acc);
          }
          if (typeof tc.id === "string" && tc.id.length > 0) acc.id = tc.id;
          const fn = tc.function as Record<string, unknown> | undefined;
          if (fn) {
            if (typeof fn.name === "string" && fn.name.length > 0) acc.name = fn.name;
            if (typeof fn.arguments === "string") acc.argsBuffer += fn.arguments;
          }
          // Emit tool-use-start once we have both id and name
          if (!acc.emittedStart && acc.id && acc.name) {
            acc.emittedStart = true;
            yield { kind: "tool-use-start", index, id: acc.id, name: acc.name };
          }
          if (acc.emittedStart && fn && typeof fn.arguments === "string" && fn.arguments.length > 0) {
            yield { kind: "tool-use-input", index, id: acc.id, partial: fn.arguments };
          }
        }
      }

      if (typeof choice.finish_reason === "string") {
        finishReason = choice.finish_reason;
      }
    }

    // Close any open text block
    if (textIndex !== -1) {
      finalText += turnText;
      yield { kind: "text-stop", index: textIndex, text: turnText };
    }

    // Emit tool-use-stop for every accumulator, parse its full input
    const toolCallsForAssistant: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];
    const parsedToolCalls: Array<{ index: number; id: string; name: string; input: unknown }> = [];
    const sortedAccs = Array.from(toolAccs.entries()).sort((a, b) => a[0] - b[0]);
    for (const [index, acc] of sortedAccs) {
      if (!acc.id || !acc.name) continue;
      let input: unknown = {};
      if (acc.argsBuffer.length > 0) {
        try {
          input = JSON.parse(acc.argsBuffer);
        } catch {
          input = { _raw: acc.argsBuffer };
        }
      }
      yield { kind: "tool-use-stop", index, id: acc.id, name: acc.name, input };
      parsedToolCalls.push({ index, id: acc.id, name: acc.name, input });
      toolCallsForAssistant.push({
        id: acc.id,
        type: "function",
        function: { name: acc.name, arguments: acc.argsBuffer || "{}" }
      });
    }

    messages.push({
      role: "assistant",
      content: turnText || null,
      tool_calls: toolCallsForAssistant.length > 0 ? toolCallsForAssistant : undefined
    });

    yield { kind: "turn-stop", turn, stopReason: finishReason };

    if (finishReason !== "tool_calls" || parsedToolCalls.length === 0) {
      yield { kind: "loop-done", reason: "end-turn", finalText };
      return;
    }

    for (const tc of parsedToolCalls) {
      const skill = skillById.get(tc.name);
      if (!skill) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Skill '${tc.name}' is not available`
        });
        yield {
          kind: "tool-result",
          toolUseId: tc.id,
          skill: tc.name,
          ok: false,
          durationMs: 0,
          error: `Skill '${tc.name}' is not available`
        };
        continue;
      }
      if (mode === "selective" && skill.dangerous) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "SELECTIVE_HOLD: dangerous skill held for user approval. Do not retry this tool in this session."
        });
        heldActions = true;
        yield {
          kind: "tool-held",
          toolUseId: tc.id,
          skill: skill.id,
          input: tc.input,
          reason: "dangerous skill held for approval"
        };
        continue;
      }
      const started = Date.now();
      try {
        const result = await config.runtime.invoke(skill.pluginId, {
          action: skill.action,
          input: tc.input
        });
        const durationMs = Date.now() - started;
        const content = result.ok ? safeStringify(result.data) : safeStringify({ error: result.error });
        messages.push({ role: "tool", tool_call_id: tc.id, content });
        yield {
          kind: "tool-result",
          toolUseId: tc.id,
          skill: skill.id,
          ok: result.ok,
          durationMs,
          data: result.ok ? result.data : undefined,
          error: result.ok ? undefined : result.error
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const message = (err as Error).message;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: safeStringify({ error: message })
        });
        yield {
          kind: "tool-result",
          toolUseId: tc.id,
          skill: skill.id,
          ok: false,
          durationMs,
          error: message
        };
      }
    }

    if (heldActions) {
      yield { kind: "loop-done", reason: "end-turn", finalText };
      return;
    }
  }

  yield { kind: "loop-done", reason: "max-iterations", finalText };
}

/* ---------------- SSE parser ---------------- */

interface OpenAISseChunk {
  choices?: unknown;
  [k: string]: unknown;
}

export async function* parseOpenAISse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<OpenAISseChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseOaiBlock(raw);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim().length > 0) {
      const parsed = parseOaiBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

function parseOaiBlock(raw: string): OpenAISseChunk | null {
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) data += line.slice(6);
    else if (line.startsWith("data:")) data += line.slice(5);
  }
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as OpenAISseChunk;
  } catch {
    return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
