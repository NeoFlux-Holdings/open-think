/**
 * costTracking tests — exercise the in-memory aggregation via a small D1 fake.
 * We DON'T hit the real AI Gateway API here; `rollupAiGatewayCosts` is tested
 * via its config-guard paths only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  enforceSpendingCap,
  getDailyCost,
  recordSpend,
  rollupAiGatewayCosts
} from "../src/costTracking";
import type { Env } from "../src/types";

interface Row {
  day: string;
  provider: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  updated_at: string;
}

function fakeD1(): { db: D1Database; rows: Row[] } {
  const rows: Row[] = [];
  const db = {
    prepare(sql: string) {
      return {
        _sql: sql,
        _binds: [] as unknown[],
        bind(...args: unknown[]) {
          this._binds = args;
          return this;
        },
        async run() {
          if (/INSERT INTO cost_daily/i.test(this._sql)) {
            if (this._binds.length === 7) {
              // recordSpend: calls=1 is hardcoded in the SQL (no bind slot).
              // ON CONFLICT: existing row's calls += 1, counters += incoming.
              const [day, provider, prompt, completion, total, cost, updated] = this._binds as [
                string, string, number, number, number, number, string
              ];
              const existing = rows.find((r) => r.day === day && r.provider === provider);
              if (existing) {
                existing.calls += 1;
                existing.prompt_tokens += prompt;
                existing.completion_tokens += completion;
                existing.total_tokens += total;
                existing.cost_usd += cost;
                existing.updated_at = updated;
              } else {
                rows.push({
                  day,
                  provider,
                  calls: 1,
                  prompt_tokens: prompt,
                  completion_tokens: completion,
                  total_tokens: total,
                  cost_usd: cost,
                  updated_at: updated
                });
              }
            } else if (this._binds.length === 8) {
              // rollupAiGatewayCosts: full-replace with explicit calls count.
              const [day, provider, calls, prompt, completion, total, cost, updated] = this
                ._binds as [string, string, number, number, number, number, number, string];
              const existing = rows.find((r) => r.day === day && r.provider === provider);
              const snapshot = {
                day,
                provider,
                calls,
                prompt_tokens: prompt,
                completion_tokens: completion,
                total_tokens: total,
                cost_usd: cost,
                updated_at: updated
              };
              if (existing) Object.assign(existing, snapshot);
              else rows.push(snapshot);
            }
          }
          return { meta: { changes: 0 } };
        },
        async all<T = unknown>() {
          if (/FROM cost_daily/i.test(this._sql)) {
            const [day] = this._binds as [string];
            const matches = rows
              .filter((r) => r.day === day)
              .map((r) => ({
                day: r.day,
                provider: r.provider,
                calls: r.calls,
                promptTokens: r.prompt_tokens,
                completionTokens: r.completion_tokens,
                totalTokens: r.total_tokens,
                costUsd: r.cost_usd,
                updatedAt: r.updated_at
              })) as unknown as T[];
            return { results: matches };
          }
          return { results: [] as T[] };
        }
      };
    }
  } as unknown as D1Database;
  return { db, rows };
}

function baseEnv(partial: Partial<Env> = {}): Env {
  return { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "", ...partial } as Env;
}

describe("costTracking", () => {
  it("recordSpend aggregates per (day, provider)", async () => {
    const { db, rows } = fakeD1();
    const env = baseEnv({ DB: db });
    await recordSpend(env, { provider: "anthropic", promptTokens: 100, completionTokens: 200, costUsd: 0.004 });
    await recordSpend(env, { provider: "anthropic", promptTokens: 50, completionTokens: 75, costUsd: 0.002 });
    await recordSpend(env, { provider: "workers-ai", promptTokens: 20, completionTokens: 30, costUsd: 0 });
    expect(rows).toHaveLength(2);
    const anthro = rows.find((r) => r.provider === "anthropic")!;
    expect(anthro.calls).toBe(2);
    expect(anthro.prompt_tokens).toBe(150);
    expect(anthro.completion_tokens).toBe(275);
    expect(anthro.cost_usd).toBeCloseTo(0.006, 4);
  });

  it("getDailyCost returns rows sorted by cost desc for today", async () => {
    const { db } = fakeD1();
    const env = baseEnv({ DB: db });
    await recordSpend(env, { provider: "anthropic", costUsd: 2.5 });
    await recordSpend(env, { provider: "workers-ai", costUsd: 0.1 });
    const rows = await getDailyCost(env);
    expect(rows).toHaveLength(2);
    expect(rows[0].provider).toBe("anthropic");
  });

  it("enforceSpendingCap blocks when spend exceeds cap", async () => {
    const { db } = fakeD1();
    const env = baseEnv({ DB: db, DAILY_SPEND_CAP_USD: "1" });
    await recordSpend(env, { provider: "anthropic", costUsd: 0.5 });
    const under = await enforceSpendingCap(env);
    expect(under.allowed).toBe(true);
    await recordSpend(env, { provider: "anthropic", costUsd: 0.6 });
    const over = await enforceSpendingCap(env);
    expect(over.allowed).toBe(false);
    expect(over.reason).toMatch(/cap/i);
  });

  it("enforceSpendingCap no-op when cap is unset", async () => {
    const { db } = fakeD1();
    const env = baseEnv({ DB: db });
    const r = await enforceSpendingCap(env);
    expect(r.allowed).toBe(true);
    expect(r.cap).toBe(null);
  });

  it("rollupAiGatewayCosts degrades gracefully when config missing", async () => {
    const r1 = await rollupAiGatewayCosts(baseEnv());
    expect(r1.ok).toBe(false);
    expect(r1.note).toMatch(/required/);

    const r2 = await rollupAiGatewayCosts(
      baseEnv({ CLOUDFLARE_ACCOUNT_ID: "acct", AI_GATEWAY_ID: "gw" })
    );
    expect(r2.ok).toBe(false);
    expect(r2.note).toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  it("rollupAiGatewayCosts writes one row per provider on success", async () => {
    const { db, rows } = fakeD1();
    const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: [
            { created_at: `${yday}T10:00Z`, provider: "anthropic", tokens_in: 100, tokens_out: 200, cost: 0.01 },
            { created_at: `${yday}T12:00Z`, provider: "anthropic", tokens_in: 50, tokens_out: 80, cost: 0.005 },
            { created_at: `${yday}T13:00Z`, provider: "openai", tokens_in: 300, tokens_out: 100, cost: 0.02 }
          ]
        }),
        { status: 200 }
      )
    );
    const env = baseEnv({
      DB: db,
      CLOUDFLARE_ACCOUNT_ID: "acct",
      AI_GATEWAY_ID: "gw",
      CLOUDFLARE_API_TOKEN: "tok"
    });
    const r = await rollupAiGatewayCosts(env);
    expect(r.ok).toBe(true);
    expect(r.rows).toBe(2);
    const anthro = rows.find((r) => r.provider === "anthropic" && r.day === yday)!;
    expect(anthro.calls).toBe(2);
    expect(anthro.cost_usd).toBeCloseTo(0.015, 4);
    fetchSpy.mockRestore();
  });
});
