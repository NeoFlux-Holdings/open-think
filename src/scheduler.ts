/**
 * Scheduler — maps cron fires to named workflows.
 *
 * A "workflow" in this context is a Helm-authored named flow stored in D1
 * (table `pa_workflows`): a trigger (cron expression) + a named handler
 * (e.g. `morning-briefing`) + serialized params.
 *
 * The Worker's top-level `scheduled()` handler calls `runScheduledCron()`
 * below with every cron fire. We match the firing cron against the workflow
 * table and dispatch to the handler registry.
 *
 * For complex multi-step flows we delegate to Cloudflare Workflows (durable,
 * retriable). For tiny flows (one-off skill invocations) we just call the
 * skill directly.
 */

import type { Env } from "./types";
import { AgentRuntime } from "./core/runtime";
import { SkillManager } from "./core/skills";
import { getPlugins } from "./plugins/registry";

export interface PAWorkflowRow {
  id: string;
  name: string;            // human label, e.g. "morning-briefing"
  cron: string;            // cron expression that triggers it
  handler: string;         // registered handler id, e.g. "morning-briefing" or "skill:memory-list"
  paramsJson: string | null;
  enabled: number;
  lastFiredAt: string | null;
  createdAt: string;
}

export type WorkflowHandler = (
  env: Env,
  runtime: AgentRuntime,
  skills: SkillManager,
  params: unknown,
  firing: { cron: string; scheduledTime: number }
) => Promise<unknown>;

const HANDLERS = new Map<string, WorkflowHandler>();

export function registerWorkflow(id: string, handler: WorkflowHandler): void {
  HANDLERS.set(id, handler);
}

export function listWorkflowHandlers(): string[] {
  return [...HANDLERS.keys()];
}

export async function ensureWorkflowTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS pa_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        handler TEXT NOT NULL,
        params_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_fired_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
  await env.DB
    .prepare(`CREATE INDEX IF NOT EXISTS idx_pa_workflows_cron ON pa_workflows(cron) WHERE enabled = 1`)
    .run();
}

export async function listScheduledWorkflows(env: Env): Promise<PAWorkflowRow[]> {
  if (!env.DB) return [];
  await ensureWorkflowTable(env);
  const rs = await env.DB
    .prepare(
      `SELECT id, name, cron, handler, params_json as paramsJson, enabled, last_fired_at as lastFiredAt, created_at as createdAt
         FROM pa_workflows
        ORDER BY created_at DESC`
    )
    .all<PAWorkflowRow>();
  return rs.results ?? [];
}

export async function upsertWorkflow(env: Env, row: Partial<PAWorkflowRow> & { name: string; cron: string; handler: string }): Promise<PAWorkflowRow> {
  if (!env.DB) throw new Error("DB binding required for scheduler");
  await ensureWorkflowTable(env);
  const id = row.id ?? crypto.randomUUID();
  const paramsJson = row.paramsJson ?? null;
  const enabled = row.enabled ?? 1;
  const createdAt = row.createdAt ?? new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO pa_workflows (id, name, cron, handler, params_json, enabled, last_fired_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, row.name, row.cron, row.handler, paramsJson, enabled, row.lastFiredAt ?? null, createdAt)
    .run();
  return {
    id,
    name: row.name,
    cron: row.cron,
    handler: row.handler,
    paramsJson,
    enabled,
    lastFiredAt: row.lastFiredAt ?? null,
    createdAt
  };
}

export async function deleteWorkflow(env: Env, id: string): Promise<boolean> {
  if (!env.DB) return false;
  await ensureWorkflowTable(env);
  const rs = await env.DB.prepare(`DELETE FROM pa_workflows WHERE id = ?`).bind(id).run();
  return (rs.meta.changes ?? 0) > 0;
}

/**
 * Called from the Worker's `scheduled()` handler. Finds all enabled workflows
 * whose `cron` matches the firing cron (exact string match — Cloudflare
 * passes the trigger expression back, so matching is trivial), runs them in
 * parallel, and updates `last_fired_at`.
 */
export async function runScheduledCron(
  env: Env,
  firing: { cron: string; scheduledTime: number }
): Promise<{ ran: number; errors: Array<{ id: string; error: string }> }> {
  const runtime = await AgentRuntime.bootstrap(env, getPlugins());
  const skills = new SkillManager(runtime);

  const all = await listScheduledWorkflows(env);
  const matched = all.filter((w) => w.enabled === 1 && w.cron === firing.cron);

  let ran = 0;
  const errors: Array<{ id: string; error: string }> = [];

  await Promise.all(
    matched.map(async (w) => {
      const handler = HANDLERS.get(w.handler);
      if (!handler) {
        errors.push({ id: w.id, error: `unknown handler '${w.handler}'` });
        return;
      }
      try {
        const params = w.paramsJson ? JSON.parse(w.paramsJson) : {};
        await handler(env, runtime, skills, params, firing);
        ran += 1;
        if (env.DB) {
          await env.DB
            .prepare(`UPDATE pa_workflows SET last_fired_at = ? WHERE id = ?`)
            .bind(new Date().toISOString(), w.id)
            .run();
        }
      } catch (err) {
        errors.push({ id: w.id, error: (err as Error).message });
      }
    })
  );

  return { ran, errors };
}

/* ---------------- Shipped handlers ---------------- */

/**
 * Simple skill-runner handler. Registered as `skill:*` — the handler id
 * `skill:memory-list` runs the `memory-list` skill with stored params.
 */
registerWorkflow("skill-runner", async (_env, _runtime, skills, params) => {
  const p = params as { skillId: string; input?: unknown };
  if (!p?.skillId) throw new Error("params.skillId required");
  return skills.invoke(p.skillId, { input: p.input });
});

/**
 * Daily cost rollup — pulls yesterday's AI Gateway logs and aggregates them
 * into `cost_daily`. Wire to a cron like `15 1 * * *` (01:15 UTC) for a stable
 * snapshot after the calendar day closes.
 */
registerWorkflow("cost-rollup", async (env) => {
  const { rollupAiGatewayCosts } = await import("./costTracking");
  return await rollupAiGatewayCosts(env);
});
