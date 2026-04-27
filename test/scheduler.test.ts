/**
 * scheduler tests — exercise the workflow-table upsert + cron dispatch.
 */
import { describe, expect, it, vi } from "vitest";
import {
  listWorkflowHandlers,
  registerWorkflow,
  runScheduledCron,
  upsertWorkflow
} from "../src/scheduler";
// Importing this triggers the morning-briefing handler self-registration.
import "../src/workflows/morningBriefing";
import type { Env } from "../src/types";

interface Row {
  id: string;
  name: string;
  cron: string;
  handler: string;
  params_json: string | null;
  enabled: number;
  last_fired_at: string | null;
  created_at: string;
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
          if (/INSERT OR REPLACE INTO pa_workflows/i.test(this._sql)) {
            const [id, name, cron, handler, paramsJson, enabled, lastFiredAt, createdAt] = this
              ._binds as [string, string, string, string, string | null, number, string | null, string];
            const i = rows.findIndex((r) => r.id === id);
            const row: Row = {
              id,
              name,
              cron,
              handler,
              params_json: paramsJson,
              enabled,
              last_fired_at: lastFiredAt,
              created_at: createdAt
            };
            if (i >= 0) rows[i] = row;
            else rows.push(row);
          }
          if (/UPDATE pa_workflows SET last_fired_at/i.test(this._sql)) {
            const [lastFiredAt, id] = this._binds as [string, string];
            const row = rows.find((r) => r.id === id);
            if (row) row.last_fired_at = lastFiredAt;
          }
          return { meta: { changes: 0 } };
        },
        async all<T = unknown>() {
          return {
            results: rows.map((r) => ({
              id: r.id,
              name: r.name,
              cron: r.cron,
              handler: r.handler,
              paramsJson: r.params_json,
              enabled: r.enabled,
              lastFiredAt: r.last_fired_at,
              createdAt: r.created_at
            })) as unknown as T[]
          };
        }
      };
    }
  } as unknown as D1Database;
  return { db, rows };
}

function baseEnv(partial: Partial<Env> = {}): Env {
  return { ENABLED_PLUGINS: "admin", ALLOWED_HOSTS: "api.cloudflare.com", ...partial } as Env;
}

describe("scheduler", () => {
  it("registers built-in handlers at module load", () => {
    const handlers = listWorkflowHandlers();
    expect(handlers).toContain("morning-briefing");
    expect(handlers).toContain("cost-rollup");
    expect(handlers).toContain("skill-runner");
  });

  it("upsertWorkflow round-trips", async () => {
    const { db, rows } = fakeD1();
    const row = await upsertWorkflow(baseEnv({ DB: db }), {
      name: "test",
      cron: "* * * * *",
      handler: "skill-runner",
      paramsJson: JSON.stringify({ skillId: "admin-introspect" })
    });
    expect(row.id).toBeTruthy();
    expect(rows).toHaveLength(1);
  });

  it("runScheduledCron dispatches matching workflows and skips non-matches", async () => {
    const { db } = fakeD1();
    const env = baseEnv({ DB: db });
    const spy = vi.fn();
    spy.mockResolvedValue({ ok: true });
    registerWorkflow("test-handler", async (...args) => spy(...args));

    await upsertWorkflow(env, {
      name: "match",
      cron: "*/5 * * * *",
      handler: "test-handler",
      paramsJson: JSON.stringify({ a: 1 })
    });
    await upsertWorkflow(env, {
      name: "skip",
      cron: "0 12 * * *",
      handler: "test-handler"
    });

    // AgentRuntime.bootstrap + getPlugins() are called internally; they touch
    // the plugin registry but don't hit the network, so this runs clean in unit
    // tests. If future plugins need bindings we'll inject a narrower env here.
    const result = await runScheduledCron(env, { cron: "*/5 * * * *", scheduledTime: Date.now() });
    expect(result.ran).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
    const firstCall = spy.mock.calls[0] as unknown[];
    expect(firstCall[3]).toEqual({ a: 1 });
  });

  it("runScheduledCron records per-workflow errors without short-circuiting", async () => {
    const { db } = fakeD1();
    const env = baseEnv({ DB: db });
    registerWorkflow("good-handler", async () => ({ ok: true }));
    registerWorkflow("bad-handler", async () => {
      throw new Error("boom");
    });
    await upsertWorkflow(env, { name: "ok", cron: "1 * * * *", handler: "good-handler" });
    await upsertWorkflow(env, { name: "boom", cron: "1 * * * *", handler: "bad-handler" });

    const r = await runScheduledCron(env, { cron: "1 * * * *", scheduledTime: Date.now() });
    expect(r.ran).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].error).toMatch(/boom/);
  });
});
