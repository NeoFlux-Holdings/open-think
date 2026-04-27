/**
 * Per-model price tables and a small helper that estimates a USD cost from
 * (model, prompt_tokens, completion_tokens). Used by the spending-cap +
 * recordSpend pre/post hooks in every provider plugin.
 *
 * Prices are approximations published by the model providers. They drift
 * (Anthropic and OpenAI have both raised + cut prices in the past year). The
 * authoritative truth for AI Gateway calls is `rollupAiGatewayCosts()`, which
 * pulls cost from CF analytics and overwrites yesterday's row. This table
 * only matters for *direct* (non-gateway) provider calls, where we need a
 * number to compare against `DAILY_SPEND_CAP_USD`.
 *
 * Update-by hint: if the model isn't found, `estimateCostUsd` falls back to a
 * conservative "$10 per million tokens" rate (≈ Anthropic Sonnet output).
 * That over-estimates cheap models and under-estimates frontier ones, but
 * it's a finite number, which is the property the cap needs.
 *
 * Last updated: 2026-04 (rates checked against Anthropic/OpenAI/CF docs).
 */

export interface ModelRate {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens */
  outputPerM: number;
}

const FALLBACK_PER_M = 10;

const RATES: Record<string, ModelRate> = {
  // --- Anthropic ---
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0 },
  "claude-haiku-4-5-20251001": { inputPerM: 1.0, outputPerM: 5.0 },
  "claude-sonnet-4-5": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-opus-4-6": { inputPerM: 15.0, outputPerM: 75.0 },
  "claude-3-5-sonnet-20241022": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-3-5-haiku-20241022": { inputPerM: 0.8, outputPerM: 4.0 },

  // --- OpenAI / Codex ---
  "gpt-5": { inputPerM: 5.0, outputPerM: 15.0 },
  "gpt-5-mini": { inputPerM: 0.5, outputPerM: 1.5 },
  "gpt-4.1": { inputPerM: 3.0, outputPerM: 12.0 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10.0 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4 },

  // --- OpenAI-compatible self-hosted (treat as zero — user's own infra) ---
  "ollama": { inputPerM: 0, outputPerM: 0 },
  "self-hosted": { inputPerM: 0, outputPerM: 0 },

  // --- Workers AI (free tier — usage is free up to a quota Cloudflare resets daily) ---
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inputPerM: 0, outputPerM: 0 },
  "@cf/meta/llama-3.1-8b-instruct": { inputPerM: 0, outputPerM: 0 }
};

/**
 * Returns the published rate for a model id, or a conservative fallback.
 * The fallback (`10 USD / 1M tokens`) intentionally over-charges so the cap
 * trips early on unknown models — better to refuse a call than blow the budget.
 */
export function getModelRate(model: string | undefined | null): ModelRate {
  if (!model) return { inputPerM: FALLBACK_PER_M, outputPerM: FALLBACK_PER_M };
  if (RATES[model]) return RATES[model];
  // Strip "anthropic/" / "openai/" / etc. prefixes for cf-ai-gateway model strings.
  const slash = model.indexOf("/");
  if (slash >= 0) {
    const tail = model.slice(slash + 1);
    if (RATES[tail]) return RATES[tail];
  }
  return { inputPerM: FALLBACK_PER_M, outputPerM: FALLBACK_PER_M };
}

/** Estimate cost in USD for a single call, given token counts + model id. */
export function estimateCostUsd(
  model: string | undefined | null,
  promptTokens: number,
  completionTokens: number
): number {
  const rate = getModelRate(model);
  return (
    (promptTokens / 1_000_000) * rate.inputPerM +
    (completionTokens / 1_000_000) * rate.outputPerM
  );
}

/* ------------ token-usage extractors per provider ------------ */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Anthropic's `/v1/messages` returns `usage: { input_tokens, output_tokens }`.
 * Returns zero counts when the response is missing usage (e.g. error path).
 */
export function extractAnthropicUsage(payload: unknown): TokenUsage {
  if (!payload || typeof payload !== "object") return { promptTokens: 0, completionTokens: 0 };
  const u = (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return {
    promptTokens: Number(u?.input_tokens ?? 0),
    completionTokens: Number(u?.output_tokens ?? 0)
  };
}

/**
 * OpenAI / OpenAI-compatible / Codex returns `usage: { prompt_tokens, completion_tokens }`
 * (occasionally nested under `response.usage`).
 */
export function extractOpenAIUsage(payload: unknown): TokenUsage {
  if (!payload || typeof payload !== "object") return { promptTokens: 0, completionTokens: 0 };
  const obj = payload as { usage?: unknown; response?: { usage?: unknown } };
  const u = (obj.usage ?? obj.response?.usage) as
    | { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }
    | undefined;
  return {
    promptTokens: Number(u?.prompt_tokens ?? u?.input_tokens ?? 0),
    completionTokens: Number(u?.completion_tokens ?? u?.output_tokens ?? 0)
  };
}
