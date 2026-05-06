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

/**
 * Provider-agnostic reasoning effort. Adapters map this to the right
 * shape per provider:
 *   - OpenAI / OpenRouter / cf-ai-gateway compat:
 *       request body adds `reasoning: { effort: "<level>" }`.
 *       OpenAI also accepts `reasoning_effort: "<level>"` at the top level
 *       (legacy) — we send the nested form which the newer GPT-5.5 models
 *       expect.
 *   - Anthropic native:
 *       maps to `thinking: { type: "enabled", budget_tokens: <N> }`.
 *       "none" disables thinking; budgets scale with effort.
 *
 * Empty / undefined → adapter omits the parameter, preserving each
 * provider's own default behavior.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

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
  /**
   * Reasoning effort the adapter forwards to the provider. Resolved by
   * the conductor from `env.MODEL_REASONING_EFFORT` (set on the deploy
   * form's "Default chat model" picker), with per-request override
   * available via the chat-tools input body in the future.
   */
  reasoningEffort?: ReasoningEffort;
}

export const DEFAULT_MAX_ITERATIONS = 6;
export const MAX_ITERATION_CEILING = 12;

/**
 * Map our normalized effort levels to Anthropic `thinking.budget_tokens`.
 * "none" returns null (caller should omit the thinking field entirely).
 * Numbers chosen to span Anthropic's recommended ranges:
 *   low    ≈ 1024 tokens — short reflective passes
 *   medium ≈ 4096        — meaningful planning before tool use
 *   high   ≈ 16384       — extended chain-of-thought
 *   xhigh  ≈ 32768       — Anthropic's max for non-Opus tiers; Opus 4.7
 *                          can go up to 64k but defaulting lower keeps
 *                          per-request cost predictable.
 */
export function reasoningEffortToAnthropicBudget(
  effort: ReasoningEffort | undefined
): number | null {
  if (!effort || effort === "none") return null;
  switch (effort) {
    case "low":    return 1024;
    case "medium": return 4096;
    case "high":   return 16384;
    case "xhigh":  return 32768;
    default:       return null;
  }
}

/**
 * Read the deploy-form-set MODEL_REASONING_EFFORT env var + validate it.
 * Returns undefined when the var is absent or an unrecognized value, so
 * adapters skip adding the field to their request bodies.
 */
export function readReasoningEffortFromEnv(env: Env): ReasoningEffort | undefined {
  const raw = env.MODEL_REASONING_EFFORT;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "none" || trimmed === "low" || trimmed === "medium" ||
      trimmed === "high" || trimmed === "xhigh") {
    return trimmed;
  }
  return undefined;
}
