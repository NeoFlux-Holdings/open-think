/**
 * Shared types for provider-agnostic tool-use streaming.
 *
 * Each provider adapter (Anthropic native, OpenAI-compatible, cf-ai-gateway compat)
 * emits the same `LoopEvent` union so consumers downstream — HTTP/SSE handlers,
 * UI, durable object hubs — can be provider-agnostic.
 */

import type { Env } from "./types";
import type { AgentRuntime } from "./core/runtime";
import type { SkillDefinition } from "./core/skills";

export type LoopEvent =
  | { kind: "turn-start"; turn: number }
  | { kind: "text-start"; index: number }
  | { kind: "text-delta"; index: number; text: string }
  | { kind: "text-stop"; index: number; text: string }
  | { kind: "tool-use-start"; index: number; id: string; name: string }
  | { kind: "tool-use-input"; index: number; id: string; partial: string }
  | { kind: "tool-use-stop"; index: number; id: string; name: string; input: unknown }
  | {
      kind: "tool-result";
      toolUseId: string;
      skill: string;
      ok: boolean;
      durationMs: number;
      data?: unknown;
      error?: string;
    }
  | { kind: "tool-held"; toolUseId: string; skill: string; input: unknown; reason: string }
  | { kind: "turn-stop"; turn: number; stopReason: string | null }
  | {
      kind: "loop-done";
      reason: "end-turn" | "max-iterations" | "cancelled" | "error";
      finalText: string;
    }
  | { kind: "error"; message: string; code?: string };

export interface ToolLoopConfig {
  env: Env;
  runtime: AgentRuntime;
  skillList: SkillDefinition[];
  systemPrompt: string;
  /** Prior history (user/assistant only). Adapter chooses how to translate. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Latest user input for this turn. */
  userContent: string;
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
  mode?: "propose" | "selective" | "auto";
  abortSignal?: AbortSignal;
}

export const DEFAULT_MAX_ITERATIONS = 6;
export const MAX_ITERATION_CEILING = 12;
