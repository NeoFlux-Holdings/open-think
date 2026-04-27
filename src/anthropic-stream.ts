/**
 * Anthropic Messages API streaming + tool-use loop.
 *
 * Talks directly to api.anthropic.com (not through the anthropic plugin) because
 * PluginResult is a buffered JSON payload; streaming needs an event producer.
 * Emits the provider-agnostic {@link LoopEvent} union defined in
 * `src/tool-stream-types.ts` so downstream consumers (HTTP/SSE handler, UI,
 * durable hubs) work identically across providers.
 */

import { buildAnthropicTools } from "./conductor";
import {
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATION_CEILING,
  type LoopEvent,
  type ToolLoopConfig
} from "./tool-stream-types";

export type { LoopEvent, ToolLoopConfig } from "./tool-stream-types";

export interface AnthropicStreamMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export async function* runAnthropicToolStream(
  config: ToolLoopConfig
): AsyncGenerator<LoopEvent, void, unknown> {
  const apiKey = config.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { kind: "error", message: "ANTHROPIC_API_KEY is required for Anthropic streaming", code: "E_ANTHROPIC_KEY_MISSING" };
    return;
  }

  const skillById = new Map(config.skillList.map((s) => [s.id, s]));
  const tools = buildAnthropicTools(config.skillList);
  const mode = config.mode ?? "selective";
  const maxIter = Math.min(
    Math.max(1, config.maxIterations ?? DEFAULT_MAX_ITERATIONS),
    MAX_ITERATION_CEILING
  );
  const model = config.model ?? DEFAULT_MODEL;

  const messages: AnthropicStreamMessage[] = [
    ...config.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: config.userContent }
  ];

  let finalText = "";
  let heldActions = false;

  for (let turn = 1; turn <= maxIter; turn += 1) {
    if (config.abortSignal?.aborted) {
      yield { kind: "loop-done", reason: "cancelled", finalText };
      return;
    }

    yield { kind: "turn-start", turn };

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        model,
        system: config.systemPrompt,
        max_tokens: config.maxTokens ?? 1024,
        messages,
        tools,
        tool_choice: { type: "auto" },
        stream: true
      }),
      signal: config.abortSignal
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      yield {
        kind: "error",
        message: `Anthropic ${response.status}: ${text.slice(0, 300)}`,
        code: "E_ANTHROPIC_HTTP"
      };
      return;
    }

    const turnBlocks: AnthropicContentBlock[] = [];
    const blockScratch: Record<number, { type: string; text?: string; id?: string; name?: string; partial?: string }> = {};
    let stopReason: string | null = null;

    for await (const event of parseAnthropicSse(response.body)) {
      if (config.abortSignal?.aborted) {
        yield { kind: "loop-done", reason: "cancelled", finalText };
        return;
      }

      const ev = event as Record<string, unknown>;
      if (ev.type === "content_block_start") {
        const idx = Number(ev.index);
        const block = (ev.content_block as { type: string; id?: string; name?: string }) ?? { type: "" };
        blockScratch[idx] = { type: block.type };
        if (block.type === "text") {
          blockScratch[idx].text = "";
          yield { kind: "text-start", index: idx };
        } else if (block.type === "tool_use") {
          blockScratch[idx].id = block.id;
          blockScratch[idx].name = block.name;
          blockScratch[idx].partial = "";
          yield { kind: "tool-use-start", index: idx, id: block.id ?? "", name: block.name ?? "" };
        }
      } else if (ev.type === "content_block_delta") {
        const idx = Number(ev.index);
        const scratch = blockScratch[idx];
        if (!scratch) continue;
        const delta = (ev.delta as { type?: string; text?: string; partial_json?: string }) ?? {};
        if (delta.type === "text_delta" && scratch.type === "text") {
          const text = String(delta.text ?? "");
          scratch.text = (scratch.text ?? "") + text;
          yield { kind: "text-delta", index: idx, text };
        } else if (delta.type === "input_json_delta" && scratch.type === "tool_use") {
          const partial = String(delta.partial_json ?? "");
          scratch.partial = (scratch.partial ?? "") + partial;
          yield { kind: "tool-use-input", index: idx, id: scratch.id ?? "", partial };
        }
      } else if (ev.type === "content_block_stop") {
        const idx = Number(ev.index);
        const scratch = blockScratch[idx];
        if (!scratch) continue;
        if (scratch.type === "text") {
          const text = scratch.text ?? "";
          turnBlocks.push({ type: "text", text });
          finalText += text;
          yield { kind: "text-stop", index: idx, text };
        } else if (scratch.type === "tool_use") {
          let input: unknown = {};
          if (scratch.partial && scratch.partial.length > 0) {
            try {
              input = JSON.parse(scratch.partial);
            } catch {
              input = { _raw: scratch.partial };
            }
          }
          turnBlocks.push({
            type: "tool_use",
            id: scratch.id ?? "",
            name: scratch.name ?? "",
            input
          });
          yield {
            kind: "tool-use-stop",
            index: idx,
            id: scratch.id ?? "",
            name: scratch.name ?? "",
            input
          };
        }
      } else if (ev.type === "message_delta") {
        const delta = (ev.delta as { stop_reason?: string }) ?? {};
        if (delta.stop_reason) stopReason = delta.stop_reason;
      } else if (ev.type === "message_stop") {
        // end of the streaming response body
      }
    }

    messages.push({ role: "assistant", content: turnBlocks });
    yield { kind: "turn-stop", turn, stopReason };

    if (stopReason !== "tool_use") {
      yield {
        kind: "loop-done",
        reason: stopReason === "end_turn" || stopReason === "stop_sequence" ? "end-turn" : "end-turn",
        finalText
      };
      return;
    }

    const toolUses = turnBlocks.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use");
    if (toolUses.length === 0) {
      yield { kind: "loop-done", reason: "end-turn", finalText };
      return;
    }

    const toolResults: AnthropicContentBlock[] = [];
    for (const tu of toolUses) {
      const skill = skillById.get(tu.name);
      if (!skill) {
        const errContent = `Skill '${tu.name}' is not available`;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: errContent,
          is_error: true
        });
        yield {
          kind: "tool-result",
          toolUseId: tu.id,
          skill: tu.name,
          ok: false,
          durationMs: 0,
          error: errContent
        };
        continue;
      }
      if (mode === "selective" && skill.dangerous) {
        const hold = "SELECTIVE_HOLD: dangerous skill held for user approval. Do not retry this tool in this session.";
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: hold, is_error: false });
        heldActions = true;
        yield {
          kind: "tool-held",
          toolUseId: tu.id,
          skill: skill.id,
          input: tu.input,
          reason: "dangerous skill held for approval"
        };
        continue;
      }
      const started = Date.now();
      try {
        const result = await config.runtime.invoke(skill.pluginId, {
          action: skill.action,
          input: tu.input
        });
        const durationMs = Date.now() - started;
        const content = result.ok ? safeStringify(result.data) : safeStringify({ error: result.error });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content,
          is_error: !result.ok
        });
        yield {
          kind: "tool-result",
          toolUseId: tu.id,
          skill: skill.id,
          ok: result.ok,
          durationMs,
          data: result.ok ? result.data : undefined,
          error: result.ok ? undefined : result.error
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const message = (err as Error).message;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: safeStringify({ error: message }),
          is_error: true
        });
        yield {
          kind: "tool-result",
          toolUseId: tu.id,
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
    messages.push({ role: "user", content: toolResults });
  }

  yield { kind: "loop-done", reason: "max-iterations", finalText };
}

/* ---------------- SSE parser ---------------- */

type SseEvent =
  | { type: "message_start"; [k: string]: unknown }
  | { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: string; [k: string]: unknown };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string; stop_sequence?: string | null } }
  | { type: "message_stop" }
  | { type: string; [k: string]: unknown };

export async function* parseAnthropicSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let blockEnd: number;
      while ((blockEnd = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, blockEnd);
        buffer = buffer.slice(blockEnd + 2);
        const parsed = parseSseBlock(raw);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim().length > 0) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseBlock(raw: string): SseEvent | null {
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) {
      data += line.slice(6);
    }
  }
  if (!data) return null;
  try {
    return JSON.parse(data) as SseEvent;
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
