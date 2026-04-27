/**
 * Cost tracking — daily rollups from the Cloudflare AI Gateway analytics API.
 *
 * The AI Gateway dashboard already shows per-gateway cost, but the PA needs
 * the number surfaced inline (daily digest, `cost-today` skill, spending-cap
 * enforcement). This module pulls gateway analytics once a day via cron,
 * stores a row in D1 (`cost_daily`), and exposes it to skills + routes.
 *
 * Analytics source: https://developers.cloudflare.com/api/operations/ai-gateway-list-logs
 * We use the gateway-wide /logs endpoint filtered to the previous UTC day,
 * aggregate token + cost fields, and write one summary row per day.
 *
 * If you don't use AI Gateway (direct Anthropic/Codex/etc.), the per-call
 * token counts from each provider's response are accumulated in-memory and
 * flushed by the same cron — see `recordSpend()` below.
 */

import type { Env } from "./types";

export interface CostDailyRow {
  day: string; // YYYY-MM-DD (UTC)
  provider: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  updatedAt: string;
}

async function ensureCostTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS cost_daily (
        day TEXT NOT NULL,
        provider TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (day, provider)
      )`
    )
    .run();
}

/**
 * Record a single LLM call's spend. Call this from provider plugins right
 * after a successful call. Aggregates are upserted per (day, provider).
 */
export async function recordSpend(
  env: Env,
  input: {
    provider: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  }
): Promise<void> {
  if (!env.DB) return;
  await ensureCostTable(env);
  const day = new Date().toISOString().slice(0, 10);
  const total = input.totalTokens ?? (input.promptTokens ?? 0) + (input.completionTokens ?? 0);
  await env.DB
    .prepare(
      `INSERT INTO cost_daily (day, provider, calls, prompt_tokens, completion_tokens, total_tokens, cost_usd, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(day, provider) DO UPDATE SET
         calls = calls + 1,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens,
         total_tokens = total_tokens + excluded.total_tokens,
         cost_usd = cost_usd + excluded.cost_usd,
         updated_at = excluded.updated_at`
    )
    .bind(
      day,
      input.provider,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      total,
      input.costUsd ?? 0,
      new Date().toISOString()
    )
    .run();
}

export async function getDailyCost(env: Env, day?: string): Promise<CostDailyRow[]> {
  if (!env.DB) return [];
  await ensureCostTable(env);
  const target = day ?? new Date().toISOString().slice(0, 10);
  const rs = await env.DB
    .prepare(
      `SELECT day, provider, calls,
              prompt_tokens as promptTokens,
              completion_tokens as completionTokens,
              total_tokens as totalTokens,
              cost_usd as costUsd,
              updated_at as updatedAt
         FROM cost_daily
        WHERE day = ?
        ORDER BY cost_usd DESC`
    )
    .bind(target)
    .all<CostDailyRow>();
  return rs.results ?? [];
}

export async function getCostRange(
  env: Env,
  startDay: string,
  endDay: string
): Promise<CostDailyRow[]> {
  if (!env.DB) return [];
  await ensureCostTable(env);
  const rs = await env.DB
    .prepare(
      `SELECT day, provider, calls,
              prompt_tokens as promptTokens,
              completion_tokens as completionTokens,
              total_tokens as totalTokens,
              cost_usd as costUsd,
              updated_at as updatedAt
         FROM cost_daily
        WHERE day BETWEEN ? AND ?
        ORDER BY day DESC, cost_usd DESC`
    )
    .bind(startDay, endDay)
    .all<CostDailyRow>();
  return rs.results ?? [];
}

/**
 * Spending-cap check. Intended to be called before any non-trivial LLM call.
 * Returns `{ allowed: true }` unless today's spend already exceeds the cap.
 */
export async function enforceSpendingCap(
  env: Env,
  capUsd?: number
): Promise<{ allowed: boolean; spent: number; cap: number | null; reason?: string }> {
  const cap = capUsd ?? (env.DAILY_SPEND_CAP_USD ? Number(env.DAILY_SPEND_CAP_USD) : null);
  if (!cap || !Number.isFinite(cap) || cap <= 0) return { allowed: true, spent: 0, cap: null };
  const rows = await getDailyCost(env);
  const spent = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  if (spent >= cap) {
    return {
      allowed: false,
      spent,
      cap,
      reason: `Daily spend cap $${cap.toFixed(2)} reached (already $${spent.toFixed(2)}). Raise DAILY_SPEND_CAP_USD or wait for tomorrow.`
    };
  }
  return { allowed: true, spent, cap };
}

/**
 * Pull yesterday's AI Gateway analytics and upsert them into `cost_daily`.
 * Intended to be called from a cron trigger each morning.
 *
 * Implementation note: the exact AI Gateway analytics endpoint / shape is
 * still evolving. We do a best-effort GET via the Cloudflare API with the
 * account id + gateway id, and graceful-degrade if either is missing.
 */
export async function rollupAiGatewayCosts(env: Env): Promise<{ ok: boolean; rows: number; note?: string }> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.AI_GATEWAY_ID) {
    return { ok: false, rows: 0, note: "CLOUDFLARE_ACCOUNT_ID + AI_GATEWAY_ID required" };
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    return { ok: false, rows: 0, note: "CLOUDFLARE_API_TOKEN required to query gateway logs" };
  }
  const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.AI_GATEWAY_ID}/logs?per_page=1000`;
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
  });
  if (!r.ok) {
    return { ok: false, rows: 0, note: `gateway analytics fetch failed: ${r.status}` };
  }
  const body = (await r.json()) as { result?: Array<Record<string, unknown>> };
  const logs = (body.result ?? []).filter((l) => String(l.created_at ?? "").startsWith(yday));
  if (logs.length === 0) return { ok: true, rows: 0, note: `no logs for ${yday}` };

  // Aggregate by provider
  const byProvider = new Map<string, { calls: number; prompt: number; completion: number; cost: number }>();
  for (const l of logs) {
    const provider = String(l.provider ?? "unknown");
    const tokensIn = Number(l.tokens_in ?? 0);
    const tokensOut = Number(l.tokens_out ?? 0);
    const cost = Number(l.cost ?? 0);
    const agg = byProvider.get(provider) ?? { calls: 0, prompt: 0, completion: 0, cost: 0 };
    agg.calls += 1;
    agg.prompt += tokensIn;
    agg.completion += tokensOut;
    agg.cost += cost;
    byProvider.set(provider, agg);
  }

  // Upsert each provider row for yesterday
  await ensureCostTable(env);
  for (const [provider, agg] of byProvider.entries()) {
    await env.DB!
      .prepare(
        `INSERT INTO cost_daily (day, provider, calls, prompt_tokens, completion_tokens, total_tokens, cost_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, provider) DO UPDATE SET
           calls = excluded.calls,
           prompt_tokens = excluded.prompt_tokens,
           completion_tokens = excluded.completion_tokens,
           total_tokens = excluded.total_tokens,
           cost_usd = excluded.cost_usd,
           updated_at = excluded.updated_at`
      )
      .bind(
        yday,
        provider,
        agg.calls,
        agg.prompt,
        agg.completion,
        agg.prompt + agg.completion,
        agg.cost,
        new Date().toISOString()
      )
      .run();
  }

  return { ok: true, rows: byProvider.size };
}
