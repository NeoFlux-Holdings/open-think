/**
 * Provider-cap + recordSpend integration tests.
 *
 * Three scenarios per provider:
 *   1. cap not configured → call proceeds, recordSpend is invoked
 *   2. cap configured but under-spent → call proceeds, recordSpend invoked
 *   3. cap configured and ALREADY exceeded → call refused before fetch
 *
 * We cover the four direct-fetch providers (anthropic, openai-compatible,
 * codex via OPENAI_API_KEY, cf-ai-gateway via the compat path). workers-ai
 * runs through env.AI.run with no costs the user is billed for, so we leave
 * it out of cap enforcement on purpose.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnthropicPlugin } from "../src/plugins/anthropic";
import { OpenAICompatiblePlugin } from "../src/plugins/openaiCompatible";
import { CodexPlugin } from "../src/plugins/codex";
import { CfAiGatewayPlugin } from "../src/plugins/cfAiGateway";
import type { Env } from "../src/types";

interface CostRow {
  day: string;
  provider: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  updated_at: string;
}

function fakeDb(seed: CostRow[] = []): { db: D1Database; rows: CostRow[] } {
  const rows: CostRow[] = [...seed];
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
          if (/INSERT INTO cost_daily/i.test(this._sql) && this._binds.length === 7) {
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AnthropicPlugin · cap + spend wiring", () => {
  async function init(env: Env): Promise<AnthropicPlugin> {
    const p = new AnthropicPlugin();
    await p.initialize({
      config: {
        enabledPlugins: new Set(["anthropic"]),
        allowedHosts: new Set(["api.anthropic.com"]),
        modelDefault: "claude-haiku-4-5",
        alertErrorRatePct: 5
      },
      fetch: globalThis.fetch,
      env
    });
    return p;
  }

  it("records spend after a successful call", async () => {
    const { db, rows } = fakeDb();
    const env: Env = {
      ENABLED_PLUGINS: "anthropic",
      ALLOWED_HOSTS: "api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-test",
      DB: db
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 100, output_tokens: 200 }
        }),
        { status: 200 }
      )
    );
    const plugin = await init(env);
    const r = await plugin.invoke("chat", {
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("anthropic");
    expect(rows[0].prompt_tokens).toBe(100);
    expect(rows[0].completion_tokens).toBe(200);
    // claude-haiku-4-5: 1 USD/M in, 5 USD/M out → 0.0001 + 0.001 = 0.0011
    expect(rows[0].cost_usd).toBeCloseTo(0.0011, 6);
  });

  it("refuses the call when today's spend is over the cap", async () => {
    const seed: CostRow = {
      day: today(),
      provider: "anthropic",
      calls: 5,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 7.5,
      updated_at: new Date().toISOString()
    };
    const { db } = fakeDb([seed]);
    const env: Env = {
      ENABLED_PLUGINS: "anthropic",
      ALLOWED_HOSTS: "api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-test",
      DB: db,
      DAILY_SPEND_CAP_USD: "5"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const plugin = await init(env);
    const r = await plugin.invoke("chat", {
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cap/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows the call when cap is set but under-spent", async () => {
    const { db } = fakeDb();
    const env: Env = {
      ENABLED_PLUGINS: "anthropic",
      ALLOWED_HOSTS: "api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-test",
      DB: db,
      DAILY_SPEND_CAP_USD: "100"
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 50, output_tokens: 100 }
        }),
        { status: 200 }
      )
    );
    const plugin = await init(env);
    const r = await plugin.invoke("chat", {
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok).toBe(true);
  });
});

describe("OpenAICompatiblePlugin · cap + spend wiring", () => {
  async function init(env: Env): Promise<OpenAICompatiblePlugin> {
    const p = new OpenAICompatiblePlugin();
    await p.initialize({
      config: {
        enabledPlugins: new Set(["openai-compatible"]),
        allowedHosts: new Set(["api.groq.com"]),
        modelDefault: "gpt-4o-mini",
        alertErrorRatePct: 5
      },
      fetch: globalThis.fetch,
      env
    });
    return p;
  }

  it("records spend after a successful call", async () => {
    const { db, rows } = fakeDb();
    const env: Env = {
      ENABLED_PLUGINS: "openai-compatible",
      ALLOWED_HOSTS: "api.groq.com",
      OPENAI_COMPATIBLE_URL: "https://api.groq.com/openai/v1",
      OPENAI_COMPATIBLE_KEY: "k",
      DB: db
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 60, completion_tokens: 80 }
        }),
        { status: 200 }
      )
    );
    const plugin = await init(env);
    const r = await plugin.invoke("chat", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("openai-compatible");
    expect(rows[0].prompt_tokens).toBe(60);
    expect(rows[0].completion_tokens).toBe(80);
  });

  it("refuses when over the cap", async () => {
    const { db } = fakeDb([
      {
        day: today(),
        provider: "openai-compatible",
        calls: 1,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 12,
        updated_at: new Date().toISOString()
      }
    ]);
    const env: Env = {
      ENABLED_PLUGINS: "openai-compatible",
      ALLOWED_HOSTS: "api.groq.com",
      OPENAI_COMPATIBLE_URL: "https://api.groq.com/openai/v1",
      OPENAI_COMPATIBLE_KEY: "k",
      DB: db,
      DAILY_SPEND_CAP_USD: "10"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const plugin = await init(env);
    const r = await plugin.invoke("chat", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("CodexPlugin · cap + spend wiring (api-key path)", () => {
  it("records spend after a successful call", async () => {
    const { db, rows } = fakeDb();
    const env: Env = {
      ENABLED_PLUGINS: "codex",
      ALLOWED_HOSTS: "api.openai.com",
      OPENAI_API_KEY: "sk-test",
      DB: db
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 30, completion_tokens: 40 }
        }),
        { status: 200 }
      )
    );
    const p = new CodexPlugin();
    await p.initialize({
      config: {
        enabledPlugins: new Set(["codex"]),
        allowedHosts: new Set(["api.openai.com"]),
        modelDefault: "gpt-5-mini",
        alertErrorRatePct: 5
      },
      fetch: globalThis.fetch,
      env
    });
    const r = await p.invoke("chat", {
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("codex");
    expect(rows[0].prompt_tokens).toBe(30);
    expect(rows[0].completion_tokens).toBe(40);
  });
});

describe("CfAiGatewayPlugin · cap + spend wiring (compat path)", () => {
  it("records spend after a successful call", async () => {
    const { db, rows } = fakeDb();
    const env: Env = {
      ENABLED_PLUGINS: "cf-ai-gateway",
      ALLOWED_HOSTS: "gateway.ai.cloudflare.com",
      AI_GATEWAY_ID: "gw",
      CLOUDFLARE_ACCOUNT_ID: "acct",
      DB: db
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        }),
        { status: 200 }
      )
    );
    const p = new CfAiGatewayPlugin();
    await p.initialize({
      config: {
        enabledPlugins: new Set(["cf-ai-gateway"]),
        allowedHosts: new Set(["gateway.ai.cloudflare.com"]),
        modelDefault: "anthropic/claude-haiku-4-5",
        alertErrorRatePct: 5
      },
      fetch: globalThis.fetch,
      env
    });
    const r = await p.invoke("chat", {
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("cf-ai-gateway");
  });
});
